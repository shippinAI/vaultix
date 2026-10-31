//go:build integration

package auth_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/database/pg"
	"github.com/vaultix/api/internal/keystore"
	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/auth/nomen"
	"github.com/vaultix/api/internal/services/kms"
	"github.com/vaultix/api/tests/infra"
)

type totpAccount struct {
	ctx           context.Context
	actor         *auth.Identity
	token, secret string
	factor        uuid.UUID
	store         keystore.KeyStore
	crypto        *kms.Service
}

func totpCode(t *testing.T, secret string, step int64) string {
	t.Helper()
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	require.NoError(t, err)
	defer clear(key)
	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], uint64(step))
	mac := hmac.New(sha1.New, key)
	_, err = mac.Write(counter[:])
	require.NoError(t, err)
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 15
	return fmt.Sprintf("%06d", (binary.BigEndian.Uint32(sum[offset:offset+4])&0x7fffffff)%1000000)
}

func newTOTPAccount(t *testing.T) *totpAccount {
	t.Helper()
	ctx, actor := newReauthenticationAccount(t)
	// Match actual Node issuer shape: an absent suborganization is omitted, not
	// the all-zero UUID emitted by Go's fixed-array omitempty test helper.
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"authTokenType": auth.AuthTokenTypeAccessToken, "authMethod": "email",
		"userId": actor.ActorID.String(), "tokenVersionId": actor.TokenVersionID.String(),
		"organizationId": actor.OrgID.String(), "accessVersion": 1,
		"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(infra.AuthSecret))
	require.NoError(t, err)
	actor, err = authenticator.ValidateJWT(ctx, token)
	require.NoError(t, err)
	ctx = auth.WithIdentity(context.Background(), actor)
	var registration struct {
		OTPURL string `json:"otpUrl"`
	}
	response, err := stack.NodeJS().Client().R().SetAuthToken(token).SetBody(struct{}{}).SetResult(&registration).Post("/api/v1/user/me/totp/register")
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, response.StatusCode(), "real TOTP registration")
	uri, err := url.Parse(registration.OTPURL)
	require.NoError(t, err)
	secret := uri.Query().Get("secret")
	require.NotEmpty(t, secret)
	response, err = stack.NodeJS().Client().R().SetAuthToken(token).SetBody(map[string]string{"totp": totpCode(t, secret, time.Now().Unix()/30)}).Post("/api/v1/user/me/totp/verify")
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, response.StatusCode(), "real TOTP enrollment verification")
	var factor uuid.UUID
	var encrypted []byte
	require.NoError(t, stack.DB().Primary().QueryRow(ctx, `SELECT id,"encryptedSecret" FROM totp_configs WHERE "userId"=$1 AND "isVerified" IS TRUE`, actor.ActorID).Scan(&factor, &encrypted))
	crypto, err := kms.NewService(ctx, infra.NopLogger(), &kms.Deps{DB: stack.DB(), Config: stack.Config(), HSM: nil, ExternalKms: nil})
	require.NoError(t, err)
	require.NoError(t, crypto.Start(ctx, false))
	t.Cleanup(crypto.Close)
	plaintext, err := crypto.DecryptAuthenticationFactor(ctx, encrypted)
	require.NoError(t, err)
	require.True(t, string(plaintext) == secret, "native KMS must decrypt the real Node-enrolled factor")
	clear(plaintext)
	client := stack.Redis().Client()
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	_, err = stack.DB().Primary().Exec(ctx, `UPDATE users SET "isMfaEnabled"=true,"selectedMfaMethod"='totp' WHERE id=$1`, actor.ActorID)
	require.NoError(t, err)
	return &totpAccount{ctx: ctx, actor: actor, token: token, secret: secret, factor: factor, crypto: crypto, store: keystore.NewKeyStore(client)}
}

func newTOTPProducer(t *testing.T, account *totpAccount, db pg.DB, crypto nomen.AuthenticationFactorCrypto, replay nomen.AuthenticationFactorReplay) (*linkingFixture, *nomen.PasswordReauthentication, nomen.IdentityIntent) {
	t.Helper()
	fixture := newLinkingFixture(t, db)
	logger := slog.New(slog.NewTextHandler(&fixture.logs, nil))
	producer, err := nomen.NewPasswordReauthentication(account.ctx, logger, &nomen.PasswordReauthenticationDeps{DB: db, Issuer: fixture.issuer, FactorCrypto: crypto, FactorReplay: replay})
	require.NoError(t, err)
	fixture.service, err = nomen.NewBindingService(account.ctx, logger, &nomen.BindingDeps{DB: db, Issuer: fixture.issuer, FreshAuthentication: producer, Introspection: fixture.verifier})
	require.NoError(t, err)
	return fixture, producer, nomen.IdentityIntent{Action: nomen.IdentityLink, Issuer: fixture.issuer}
}

func (a *totpAccount) forgetCode(t *testing.T, code string) {
	t.Helper()
	_, err := a.store.DeleteItem(a.ctx, "used-totp-code:"+a.actor.ActorID.String()+":"+code)
	require.NoError(t, err)
}

func (a *totpAccount) stepUp(t *testing.T, code string) int {
	t.Helper()
	id := uuid.NewString()
	payload, err := json.Marshal(map[string]string{"sessionId": id, "userId": a.actor.ActorID.String(), "resourceId": "mfa-management", "status": "PENDING", "mfaMethod": "totp", "initiatingTokenVersionId": a.actor.TokenVersionID.String()})
	require.NoError(t, err)
	require.NoError(t, a.store.SetItemWithExpiry(a.ctx, "mfa-session:"+id, 5*time.Minute, string(payload)))
	t.Cleanup(func() {
		_, err := a.store.DeleteItem(context.Background(), "mfa-session:"+id)
		require.NoError(t, err)
	})
	response, err := stack.NodeJS().Client().R().SetAuthToken(a.token).SetBody(map[string]string{"mfaToken": code, "mfaMethod": "totp"}).Post("/api/v2/mfa-sessions/" + id + "/verify")
	require.NoError(t, err)
	if response.StatusCode() == http.StatusBadRequest {
		var problem struct {
			Message string `json:"message"`
		}
		require.NoError(t, json.Unmarshal(response.Body(), &problem))
		require.True(t, problem.Message == "Invalid MFA code", "denial must reach the existing MFA code verifier")
		stored, err := a.store.GetItem(a.ctx, "mfa-session:"+id)
		require.NoError(t, err)
		var session struct {
			Status string `json:"status"`
		}
		require.NoError(t, json.Unmarshal([]byte(stored), &session))
		require.Equal(t, "PENDING", session.Status)
	}
	return response.StatusCode()
}

func TestTOTPReauthentication_RealEnrollmentLinkAndCrossRuntimeReplay(t *testing.T) {
	for _, first := range []string{"native", "node"} {
		t.Run(first, func(t *testing.T) {
			a := newTOTPAccount(t)
			fixture, producer, intent := newTOTPProducer(t, a, stack.DB(), a.crypto, a.store)
			code := totpCode(t, a.secret, time.Now().Unix()/30)
			if first == "native" {
				proof, err := producer.AuthenticateTOTP(a.ctx, intent, reauthPassword, code)
				require.NoError(t, err)
				challenge, err := fixture.service.BeginLink(a.ctx, proof.Code)
				require.NoError(t, err)
				binding, err := fixture.service.CompleteLink(a.ctx, challenge.Code, "fixture-access-canary")
				require.NoError(t, err)
				revoke := nomen.IdentityIntent{Action: nomen.IdentityRevoke, Issuer: fixture.issuer, BindingID: binding}
				revocation, err := producer.AuthenticateTOTP(a.ctx, revoke, reauthPassword, totpCode(t, a.secret, time.Now().Unix()/30+1))
				require.NoError(t, err)
				_, err = fixture.service.BeginLink(a.ctx, revocation.Code)
				require.ErrorIs(t, err, nomen.ErrLinkDenied)
				require.NoError(t, fixture.service.Revoke(a.ctx, binding, revocation.Code))
				require.ErrorIs(t, fixture.service.Revoke(a.ctx, binding, revocation.Code), nomen.ErrLinkDenied)
				a.forgetCode(t, code)
				require.Equal(t, http.StatusBadRequest, a.stepUp(t, code), "Node must reject native-consumed code after cache loss")
			} else {
				require.Equal(t, http.StatusOK, a.stepUp(t, code))
				a.forgetCode(t, code)
				_, err := producer.AuthenticateTOTP(a.ctx, intent, reauthPassword, code)
				require.ErrorIs(t, err, nomen.ErrLinkDenied, "native must reject Node-consumed code after cache loss")
			}
			var consumed int64
			require.NoError(t, stack.DB().Primary().QueryRow(a.ctx, `SELECT "lastStep" FROM vaultix_totp_replays WHERE "factorId"=$1`, a.factor).Scan(&consumed))
			require.Positive(t, consumed)
			a.forgetCode(t, code)
			_, err := producer.AuthenticateTOTP(a.ctx, intent, reauthPassword, code)
			require.ErrorIs(t, err, nomen.ErrLinkDenied)
			require.NotContains(t, fixture.logs.String(), a.secret)
			require.NotContains(t, fixture.logs.String(), code)
		})
	}
}

func TestTOTPReauthentication_CurrentFactorAndMethod(t *testing.T) {
	for _, scenario := range []string{"unverified", "deleted", "deleted-mfa-disabled", "changed", "other-user", "user-email", "org-email", "org-totp-overrides-user", "missing-provenance", "changed-after-provider", "password-only"} {
		t.Run(scenario, func(t *testing.T) {
			a := newTOTPAccount(t)
			fixture, producer, intent := newTOTPProducer(t, a, stack.DB(), a.crypto, a.store)
			if scenario == "password-only" {
				_, err := producer.Authenticate(a.ctx, intent, reauthPassword)
				require.ErrorIs(t, err, nomen.ErrReauthenticationMethod)
				return
			}
			code := totpCode(t, a.secret, time.Now().Unix()/30)
			proof, err := producer.AuthenticateTOTP(a.ctx, intent, reauthPassword, code)
			require.NoError(t, err)
			var query string
			id := a.actor.ActorID
			expected := nomen.ErrLinkDenied
			switch scenario {
			case "unverified":
				query = `UPDATE totp_configs SET "isVerified"=false WHERE "userId"=$1`
			case "deleted":
				query = `DELETE FROM totp_configs WHERE "userId"=$1`
				expected = nomen.ErrReauthenticationMethod
			case "deleted-mfa-disabled":
				_, err = stack.DB().Primary().Exec(a.ctx, `UPDATE users SET "isMfaEnabled"=false WHERE id=$1`, id)
				require.NoError(t, err)
				query = `DELETE FROM totp_configs WHERE "userId"=$1`
			case "changed", "changed-after-provider":
				query = `UPDATE totp_configs SET "encryptedSecret"="encryptedSecret"||decode('00','hex') WHERE "userId"=$1`
			case "user-email":
				query = `UPDATE users SET "selectedMfaMethod"='email' WHERE id=$1`
				expected = nomen.ErrReauthenticationMethod
			case "org-email":
				query = `UPDATE organizations SET "enforceMfa"=true,"selectedMfaMethod"='email' WHERE id=$1`
				id = a.actor.OrgID
				expected = nomen.ErrReauthenticationMethod
			case "org-totp-overrides-user":
				_, err = stack.DB().Primary().Exec(a.ctx, `UPDATE users SET "selectedMfaMethod"='email' WHERE id=$1`, id)
				require.NoError(t, err)
				query = `UPDATE organizations SET "enforceMfa"=true,"selectedMfaMethod"='totp' WHERE id=$1`
				id = a.actor.OrgID
			case "missing-provenance":
				_, err = stack.DB().Primary().Exec(a.ctx, `UPDATE users SET "isMfaEnabled"=false WHERE id=$1`, id)
				require.NoError(t, err)
				query = `DELETE FROM vaultix_identity_reauth_totp WHERE "userId"=$1`
			case "other-user":
				a.ctx, _ = newReauthenticationAccount(t)
			}
			if scenario == "changed-after-provider" {
				challenge, err := fixture.service.BeginLink(a.ctx, proof.Code)
				require.NoError(t, err)
				var changed atomic.Bool
				fixture.beforeResponse = func() {
					_, mutationErr := stack.DB().Primary().Exec(a.ctx, query, id)
					if mutationErr != nil {
						t.Error("factor change during provider I/O failed")
					}
					changed.Store(mutationErr == nil)
				}
				_, err = fixture.service.CompleteLink(a.ctx, challenge.Code, "fixture-access-canary")
				require.ErrorIs(t, err, expected)
				require.True(t, changed.Load())
				return
			}
			if query != "" {
				_, err = stack.DB().Primary().Exec(a.ctx, query, id)
				require.NoError(t, err)
			}
			_, err = fixture.service.BeginLink(a.ctx, proof.Code)
			if scenario == "org-totp-overrides-user" {
				require.NoError(t, err)
			} else {
				require.ErrorIs(t, err, expected)
			}
		})
	}
}

type totpReplayFailure struct{}

func (totpReplayFailure) SetItemWithExpiryNX(context.Context, string, time.Duration, string) (bool, error) {
	return false, errors.New("fixture cache unavailable")
}

func TestTOTPReauthentication_FailureRecovery(t *testing.T) {
	for _, failure := range []string{"cache", "database"} {
		t.Run(failure, func(t *testing.T) {
			a := newTOTPAccount(t)
			replay := nomen.AuthenticationFactorReplay(a.store)
			if failure == "cache" {
				replay = totpReplayFailure{}
			}
			_, producer, intent := newTOTPProducer(t, a, stack.DB(), a.crypto, replay)
			step := time.Now().Unix() / 30
			code := totpCode(t, a.secret, step)
			if failure == "database" {
				_, err := stack.DB().Primary().Exec(a.ctx, `ALTER TABLE vaultix_identity_reauth_proofs ADD CONSTRAINT fixture_totp_failure CHECK(false) NOT VALID`)
				require.NoError(t, err)
				t.Cleanup(func() {
					_, err := stack.DB().Primary().Exec(context.Background(), `ALTER TABLE vaultix_identity_reauth_proofs DROP CONSTRAINT IF EXISTS fixture_totp_failure`)
					require.NoError(t, err)
				})
			}
			_, err := producer.AuthenticateTOTP(a.ctx, intent, reauthPassword, code)
			require.ErrorIs(t, err, nomen.ErrBindingUnavailable)
			var count int
			require.NoError(t, stack.DB().Primary().QueryRow(a.ctx, `SELECT count(*) FROM vaultix_totp_replays WHERE "factorId"=$1`, a.factor).Scan(&count))
			require.Zero(t, count, "failed proof must roll back durable code consumption")
			require.NoError(t, stack.DB().Primary().QueryRow(a.ctx, `SELECT count(*) FROM vaultix_identity_reauth_proofs WHERE "userId"=$1`, a.actor.ActorID).Scan(&count))
			require.Zero(t, count)
			if failure == "database" {
				_, err = stack.DB().Primary().Exec(a.ctx, `ALTER TABLE vaultix_identity_reauth_proofs DROP CONSTRAINT fixture_totp_failure`)
				require.NoError(t, err)
				_, err = producer.AuthenticateTOTP(a.ctx, intent, reauthPassword, code)
				require.ErrorIs(t, err, nomen.ErrLinkDenied, "failed SQL must retain the cross-runtime cache claim")
			}
			_, producer, intent = newTOTPProducer(t, a, stack.DB(), a.crypto, a.store)
			_, err = producer.AuthenticateTOTP(a.ctx, intent, reauthPassword, totpCode(t, a.secret, step+1))
			require.NoError(t, err, "fresh code recovers without clearing replay state")
		})
	}
}

func TestTOTPReauthentication_ConcurrentCode(t *testing.T) {
	a := newTOTPAccount(t)
	_, producer, intent := newTOTPProducer(t, a, stack.DB(), a.crypto, a.store)
	code := totpCode(t, a.secret, time.Now().Unix()/30)
	results := make([]error, 5)
	var group sync.WaitGroup
	for i := range results {
		group.Go(func() { _, results[i] = producer.AuthenticateTOTP(a.ctx, intent, reauthPassword, code) })
	}
	group.Wait()
	accepted := 0
	for _, err := range results {
		if err == nil {
			accepted++
		} else {
			require.True(t, errors.Is(err, nomen.ErrLinkDenied) || errors.Is(err, nomen.ErrReauthenticationBusy))
		}
	}
	require.Equal(t, 1, accepted)
}

type factorConnectionProbe struct {
	nomen.AuthenticationFactorCrypto
	db pg.DB
}

func (p factorConnectionProbe) DecryptAuthenticationFactor(ctx context.Context, blob []byte) ([]byte, error) {
	var value int
	if err := p.db.Primary().QueryRow(ctx, "SELECT 1").Scan(&value); err != nil {
		return nil, err
	}
	return p.AuthenticationFactorCrypto.DecryptAuthenticationFactor(ctx, blob)
}

type replayConnectionProbe struct {
	nomen.AuthenticationFactorReplay
	db pg.DB
}

func (p replayConnectionProbe) SetItemWithExpiryNX(ctx context.Context, key string, ttl time.Duration, value string) (bool, error) {
	var one int
	if err := p.db.Primary().QueryRow(ctx, "SELECT 1").Scan(&one); err != nil {
		return false, err
	}
	return p.AuthenticationFactorReplay.SetItemWithExpiryNX(ctx, key, ttl, value)
}

func TestTOTPReauthentication_OneConnection(t *testing.T) {
	a := newTOTPAccount(t)
	config, err := pgxpool.ParseConfig(stack.Config().DBConnectionURI)
	require.NoError(t, err)
	config.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(a.ctx, config)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	db := &bindingDB{pool: pool}
	fixture, producer, intent := newTOTPProducer(t, a, db, factorConnectionProbe{a.crypto, db}, replayConnectionProbe{a.store, db})
	proof, err := producer.AuthenticateTOTP(a.ctx, intent, reauthPassword, totpCode(t, a.secret, time.Now().Unix()/30))
	require.NoError(t, err)
	challenge, err := fixture.service.BeginLink(a.ctx, proof.Code)
	require.NoError(t, err)
	_, err = fixture.service.CompleteLink(a.ctx, challenge.Code, "fixture-access-canary")
	require.NoError(t, err)
}

func TestTOTPReauthentication_IssuanceDenials(t *testing.T) {
	for _, scenario := range []string{"wrong-password", "invalid-code", "unverified-factor", "federated-session", "required-email", "closed-kms"} {
		t.Run(scenario, func(t *testing.T) {
			a := newTOTPAccount(t)
			_, producer, intent := newTOTPProducer(t, a, stack.DB(), a.crypto, a.store)
			password, code := reauthPassword, totpCode(t, a.secret, time.Now().Unix()/30)
			expected := nomen.ErrLinkDenied
			switch scenario {
			case "wrong-password":
				password = "incorrect"
			case "invalid-code":
				code = "abcdef"
			case "unverified-factor":
				_, err := stack.DB().Primary().Exec(a.ctx, `UPDATE totp_configs SET "isVerified"=false WHERE id=$1`, a.factor)
				require.NoError(t, err)
			case "federated-session":
				a.actor.AuthMethod = "oidc"
				expected = nomen.ErrReauthenticationMethod
			case "required-email":
				_, err := stack.DB().Primary().Exec(a.ctx, `UPDATE users SET "selectedMfaMethod"='email' WHERE id=$1`, a.actor.ActorID)
				require.NoError(t, err)
				expected = nomen.ErrReauthenticationMethod
			case "closed-kms":
				a.crypto.Close()
				expected = nomen.ErrBindingUnavailable
			}
			_, err := producer.AuthenticateTOTP(a.ctx, intent, password, code)
			require.ErrorIs(t, err, expected)
			var count int
			require.NoError(t, stack.DB().Primary().QueryRow(a.ctx, `SELECT count(*) FROM vaultix_identity_reauth_proofs WHERE "userId"=$1`, a.actor.ActorID).Scan(&count))
			require.Zero(t, count)
			require.NoError(t, stack.DB().Primary().QueryRow(a.ctx, `SELECT count(*) FROM vaultix_totp_replays WHERE "factorId"=$1`, a.factor).Scan(&count))
			require.Zero(t, count)
		})
	}
}

func TestTOTPReauthentication_RootAndSelectedPolicy(t *testing.T) {
	for _, scenario := range []string{"both-totp", "root-email", "selected-email"} {
		t.Run(scenario, func(t *testing.T) {
			a := newTOTPAccount(t)
			child := reauthenticationOrganization(t, a.actor.ActorID, a.actor.OrgID)
			a.ctx, a.actor = reauthenticationContext(t, a.actor.ActorID, a.actor.TokenVersionID, child, a.actor.OrgID, 1)
			_, err := stack.DB().Primary().Exec(a.ctx, `UPDATE organizations SET "enforceMfa"=true,"selectedMfaMethod"='totp' WHERE id=$1 OR id=$2`, child, a.actor.RootOrgID)
			require.NoError(t, err)
			if scenario != "both-totp" {
				id := a.actor.RootOrgID
				if scenario == "selected-email" {
					id = child
				}
				_, err = stack.DB().Primary().Exec(a.ctx, `UPDATE organizations SET "selectedMfaMethod"='email' WHERE id=$1`, id)
				require.NoError(t, err)
			}
			fixture, producer, intent := newTOTPProducer(t, a, stack.DB(), a.crypto, a.store)
			proof, err := producer.AuthenticateTOTP(a.ctx, intent, reauthPassword, totpCode(t, a.secret, time.Now().Unix()/30))
			if scenario == "both-totp" {
				require.NoError(t, err)
				_, err = fixture.service.BeginLink(a.ctx, proof.Code)
				require.NoError(t, err)
			} else {
				require.ErrorIs(t, err, nomen.ErrReauthenticationMethod)
			}
		})
	}
}

func TestTOTPReauthentication_LegacyProofUUIDDoesNotInheritFactor(t *testing.T) {
	a := newTOTPAccount(t)
	fixture, producer, intent := newTOTPProducer(t, a, stack.DB(), a.crypto, a.store)
	oldProof, err := producer.AuthenticateTOTP(a.ctx, intent, reauthPassword, totpCode(t, a.secret, time.Now().Unix()/30))
	require.NoError(t, err)
	var proofID uuid.UUID
	var digest []byte
	var step int64
	require.NoError(t, stack.DB().Primary().QueryRow(a.ctx, `SELECT "proofId","factorDigest",step FROM vaultix_identity_reauth_totp WHERE "userId"=$1`, a.actor.ActorID).Scan(&proofID, &digest, &step))
	_, err = stack.DB().Primary().Exec(a.ctx, `UPDATE users SET "isMfaEnabled"=false WHERE id=$1`, a.actor.ActorID)
	require.NoError(t, err)
	passwordProof, err := producer.Authenticate(a.ctx, intent, reauthPassword)
	require.NoError(t, err)
	// Restore the stale metadata an older password producer leaves behind when
	// replacing only the original proof row. It must not change the new method.
	_, err = stack.DB().Primary().Exec(a.ctx, `INSERT INTO vaultix_identity_reauth_totp("userId","proofId","factorId","factorDigest",step) VALUES($1,$2,$3,$4,$5)`, a.actor.ActorID, proofID, a.factor, digest, step)
	require.NoError(t, err)
	_, err = fixture.service.BeginLink(a.ctx, oldProof.Code)
	require.ErrorIs(t, err, nomen.ErrLinkDenied)
	_, err = fixture.service.BeginLink(a.ctx, passwordProof.Code)
	require.NoError(t, err)
}
