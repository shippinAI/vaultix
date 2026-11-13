package apiauth

import (
	"context"
	"errors"
	"net/http"

	"github.com/vaultix-cloud/api/internal/libs/errutil"
	"github.com/vaultix-cloud/api/internal/services/auth"
	"github.com/vaultix-cloud/api/internal/services/auth/device"
)

func (a *ApiAuthenticator) ValidateDeviceAccess(ctx context.Context, token string) (*auth.Identity, error) {
	if a.deviceAccess == nil {
		return nil, errutil.Unauthorized("Device access is not enabled for this instance")
	}
	identity, err := a.deviceAccess.AuthenticateAccess(ctx, token)
	if errors.Is(err, device.ErrUnavailable) {
		return nil, errutil.InternalServer("Device authentication is temporarily unavailable").WithStatus(http.StatusServiceUnavailable)
	}
	if err != nil || identity == nil || identity.AuthMode != auth.AuthModeDeviceAccess || identity.Actor != auth.ActorTypeUser {
		return nil, errutil.Unauthorized("Device session is invalid or no longer permitted; sign in again")
	}
	return identity, nil
}
