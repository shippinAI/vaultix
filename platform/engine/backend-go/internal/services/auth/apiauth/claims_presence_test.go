package apiauth

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
)

const completeIdentityClaimsJSON = `{"authTokenType":"identityAccessToken","identityId":"11111111-1111-4111-8111-111111111111","identityAccessTokenId":"token-id","jti":"token-id","orgId":"11111111-1111-4111-8111-111111111111","rootOrgId":"11111111-1111-4111-8111-111111111111","parentOrgId":"11111111-1111-4111-8111-111111111111","authMethod":"universal-auth","accessTokenTTL":3600,"accessTokenMaxTTL":0,"accessTokenPeriod":0,"creationEpoch":1700000000}`

func TestIdentityJWTClaims_DecodedLifetimePresence(t *testing.T) {
	t.Parallel()
	for _, field := range []string{"accessTokenTTL", "accessTokenMaxTTL", "accessTokenPeriod", "creationEpoch"} {
		for _, state := range []string{"absent", "null", "zero", "positive", "string", "fraction", "boolean"} {
			t.Run(field+"/"+state, func(t *testing.T) {
				t.Parallel()
				var payload map[string]any
				require.NoError(t, json.Unmarshal([]byte(completeIdentityClaimsJSON), &payload))
				switch state {
				case "absent":
					delete(payload, field)
				case "null":
					payload[field] = nil
				case "zero":
					payload[field] = 0
				case "positive":
					payload[field] = 60
				case "string":
					payload[field] = "0"
				case "fraction":
					payload[field] = 0.5
				case "boolean":
					payload[field] = false
				}
				encoded, err := json.Marshal(payload)
				require.NoError(t, err)
				var unified UnifiedJWTClaims
				var direct IdentityJWTClaims
				unifiedErr := json.Unmarshal(encoded, &unified)
				directErr := json.Unmarshal(encoded, &direct)
				if state == "string" || state == "fraction" || state == "boolean" {
					require.Error(t, unifiedErr)
					require.Error(t, directErr)
					return
				}
				require.NoError(t, unifiedErr)
				require.NoError(t, directErr)
				complete := state == "zero" || state == "positive"
				require.Equal(t, complete, direct.HasFullRenewClaims())
				require.Equal(t, complete, unified.ToIdentityClaims().HasFullRenewClaims())
				// Both claim representations must retain explicit zeros when encoded.
				for _, claims := range []any{unified, direct, unified.ToIdentityClaims()} {
					roundTrip, marshalErr := json.Marshal(claims)
					require.NoError(t, marshalErr)
					var decoded map[string]any
					require.NoError(t, json.Unmarshal(roundTrip, &decoded))
					if complete {
						require.Contains(t, decoded, field)
						require.EqualValues(t, payload[field], decoded[field])
					} else {
						require.NotContains(t, decoded, field)
					}
				}
			})
		}
	}
}

func TestParseJWT_ExplicitZeroLifetimeClaims(t *testing.T) {
	t.Parallel()
	var payload jwt.MapClaims
	require.NoError(t, json.Unmarshal([]byte(completeIdentityClaimsJSON), &payload))
	for _, field := range []string{"accessTokenTTL", "accessTokenMaxTTL", "accessTokenPeriod", "creationEpoch"} {
		payload[field] = 0
	}
	payload["iat"] = time.Now().Unix()
	payload["exp"] = time.Now().Add(time.Hour).Unix()
	const fixtureSecret = "claims-format-unit-fixture"
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, payload).SignedString([]byte(fixtureSecret))
	require.NoError(t, err)
	claims, err := parseJWT(token, []byte(fixtureSecret))
	require.NoError(t, err)
	require.True(t, claims.ToIdentityClaims().HasFullRenewClaims())
}

func TestParseJWT_UserAccessVersionPresence(t *testing.T) {
	t.Parallel()
	for _, state := range []string{"absent", "null", "zero", "positive", "string", "fraction", "boolean"} {
		t.Run(state, func(t *testing.T) {
			t.Parallel()
			payload := jwt.MapClaims{"authTokenType": "accessToken", "exp": time.Now().Add(time.Hour).Unix()}
			switch state {
			case "null":
				payload["accessVersion"] = nil
			case "zero":
				payload["accessVersion"] = 0
			case "positive":
				payload["accessVersion"] = 2
			case "string":
				payload["accessVersion"] = "0"
			case "fraction":
				payload["accessVersion"] = 0.5
			case "boolean":
				payload["accessVersion"] = false
			}
			const secret = "user-claim-presence-fixture"
			token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, payload).SignedString([]byte(secret))
			require.NoError(t, err)
			claims, err := parseJWT(token, []byte(secret))
			if state == "string" || state == "fraction" || state == "boolean" {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			user := claims.ToUserClaims()
			require.Equal(t, state == "zero" || state == "positive", user.accessVersionPresent)
			if state == "positive" {
				require.Equal(t, 2, user.AccessVersion)
			} else {
				require.Zero(t, user.AccessVersion)
			}
		})
	}
}
