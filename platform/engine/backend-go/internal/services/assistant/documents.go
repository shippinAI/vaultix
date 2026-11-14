package assistant

import (
	"encoding/json"
	"fmt"

	"github.com/vaultix-cloud/api/internal/services/assistant/spec"
)

// CheckConnection applies the v1 schema rules and the checks a schema cannot express: an extra
// header may not carry a credential, and a Vertex key must be a service account key.
func CheckConnection(c *spec.Connection) error {
	if err := spec.ValidateConnection(c); err != nil {
		return err
	}
	var errs spec.Errors
	for i, h := range c.Headers {
		if LooksLikeSecret(h.Value) {
			errs = append(errs, spec.FieldError{Path: fmt.Sprintf("headers[%d].value", i),
				Message: "This looks like a key. Keys go in the key field, where they are encrypted."})
		}
	}
	if c.Credential != nil && c.Credential.ServiceAccountJSON != nil {
		var account struct {
			Type        string `json:"type"`
			ClientEmail string `json:"client_email"`
			PrivateKey  string `json:"private_key"`
		}
		if json.Unmarshal([]byte(*c.Credential.ServiceAccountJSON), &account) != nil || account.Type != "service_account" ||
			account.ClientEmail == "" || account.PrivateKey == "" {
			errs = append(errs, spec.FieldError{Path: "credential.serviceAccountJson",
				Message: "Paste the whole JSON key file of a Google Cloud service account."})
		}
	}
	if len(errs) > 0 {
		return errs
	}
	return nil
}

// CheckPersona applies the v1 schema rules. Whether its tools and handoffs exist is checked where
// the live catalog and persona list are known.
func CheckPersona(p *spec.Persona) error { return spec.ValidatePersona(p) }
