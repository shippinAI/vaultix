//go:build integration

package permission_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/vaultix/api/internal/keystore"
	"github.com/vaultix/api/internal/services/auth/apiauth"
	"github.com/vaultix/api/internal/services/permission"
	"github.com/vaultix/api/tests/infra"
)

func TestSSOEnforcement_AuthenticatedEmailSession(t *testing.T) {
	projectActor := authorityActors(t)[0]
	validator, err := apiauth.NewApiAuthenticator(context.Background(), infra.NopLogger(), &apiauth.AuthenticatorDeps{
		DB: stack.DB(), AuthSecret: infra.AuthSecret, KeyStore: keystore.NewMemoryKeyStore(),
		AssumePrivilege: nil, ErrorHandler: infra.NewNopErrorHandler(), IdentityPolicy: stack.Config().IdentityTokenPolicy,
	})
	require.NoError(t, err)
	// Validate the actual disposable issuer session, not a signed method fixture.
	identity, err := validator.ValidateJWT(context.Background(), stack.NodeJS().UserToken())
	require.NoError(t, err)
	require.Equal(t, "email", string(identity.AuthMethod))
	args := &permission.GetProjectPermissionArgs{
		Actor: identity.Actor, ActorID: identity.ActorID, ActorOrgID: identity.OrgID,
		ActorAuthMethod: identity.AuthMethod, ProjectID: projectActor.ProjectID,
		ActionProjectType: permission.ActionProjectTypeSecretManager,
	}
	db, svc := newPermissionAuthority(t, func(pool *pgxpool.Pool) { setSSOPolicy(t, pool, identity.OrgID, false, false, false) })
	assertSSOAccess(t, svc, args, 0)
	setSSOPolicy(t, db.primary, identity.OrgID, true, false, false)
	assertSSOAccess(t, svc, args, 403)
	setSSOPolicy(t, db.primary, identity.OrgID, false, false, false)
	assertSSOAccess(t, svc, args, 0)
	require.Zero(t, db.replicaReads)
}
