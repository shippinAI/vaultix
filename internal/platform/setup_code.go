package platform

import (
	"context"
	"encoding/json"
	"strings"
)

// A fresh install generates a one-time first-owner setup code into the private
// environment file. The application accepts it only until the instance has its
// first owner; after that it opens nothing. The lifecycle shows it only while the
// running application still reports it as required.

const setupCodeKey = "VAULTIX_SETUP_CODE"

func newSetupCode() string { return "vxs-" + randomHex(16) }

func configuredSetupCode(root string) string {
	env, err := privateRead(configPath(root, "vaultix.env"), 1024*1024)
	if err != nil {
		return ""
	}
	code := ""
	for _, line := range strings.Split(string(env), "\n") {
		if value, ok := strings.CutPrefix(strings.TrimSpace(line), setupCodeKey+"="); ok {
			code = strings.TrimSpace(value)
		}
	}
	return code
}

// pendingSetupCode returns the configured code only while the running backend reports
// that first-owner setup still requires it. Any failure to confirm returns nothing.
func pendingSetupCode(ctx context.Context, d *Docker, root string) string {
	code := configuredSetupCode(root)
	if code == "" {
		return ""
	}
	backend, err := d.service(ctx, "backend")
	if err != nil || backend == nil {
		return ""
	}
	raw, err := d.run(ctx, "exec", backend.ID, "wget", "-qO-", "http://127.0.0.1:8080/api/v1/admin/config")
	if err != nil {
		return ""
	}
	var body struct {
		Config struct {
			SetupCodeRequired bool `json:"setupCodeRequired"`
		} `json:"config"`
	}
	if json.Unmarshal(raw, &body) != nil || !body.Config.SetupCodeRequired {
		return ""
	}
	return code
}

func withSetupCode(ctx context.Context, d *Docker, root string, result *Result) {
	code := pendingSetupCode(ctx, d, root)
	if code == "" {
		return
	}
	result.SetupCode = code
	result.SetupURL = result.Instance.SiteURL + "/admin/signup"
	result.Message = strings.TrimSpace(result.Message + " Create the first owner at " + result.SetupURL +
		" with the setup code. It works once: after the owner exists it no longer opens setup.")
}
