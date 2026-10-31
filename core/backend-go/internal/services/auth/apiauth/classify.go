package apiauth

import (
	"encoding/base64"
	"encoding/json"
	"strings"

	"github.com/vaultix/api/internal/services/auth"
	"github.com/vaultix/api/internal/services/auth/device"
)

// ClassifyToken determines the AuthMode from a raw token string using cheap checks only.
// Service tokens are identified by their "st." prefix.
// JWTs are identified by having exactly 3 dot-separated parts.
// This does NOT validate the token - only classifies it for routing.
func ClassifyToken(token string) auth.AuthMode {
	if strings.HasPrefix(token, "st.") {
		return auth.AuthModeServiceToken
	}

	// JWT format: header.payload.signature (exactly 3 parts)
	parts := strings.SplitN(token, ".", 4)
	if len(parts) != 3 {
		return ""
	}
	if len(parts[0]) <= 1024 {
		var header struct {
			Type string `json:"typ"`
		}
		decoded, err := base64.RawURLEncoding.Strict().DecodeString(parts[0])
		if err == nil && json.Unmarshal(decoded, &header) == nil && header.Type == device.AccessMediaType {
			// Routing only: this type must still pass its exclusive signature,
			// issuer/audience, dedicated session and live policy validator.
			return auth.AuthModeDeviceAccess
		}
	}

	// It looks like a JWT - actual type (user vs identity) is determined after validation
	return auth.AuthModeJWT
}
