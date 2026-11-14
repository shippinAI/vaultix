package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Owner recovery from the host. The command writes a fresh one-use code into a file inside the
// running backend container and presents it to the application over the container's own loopback,
// in one exec. Only someone who can run commands in the container can do that, and that person
// already controls the instance. The code never appears in a process argument or on the host disk.

type PasswordResetLink struct {
	URL       string `json:"url"`
	Username  string `json:"username"`
	ExpiresAt string `json:"expiresAt"`
}

// Run by `node -` from stdin inside the backend container. Values are embedded as a JSON literal,
// so no shell parses them and none reaches a process argument.
const ownerRecoveryScript = `
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { code, email } = %s;
const file = path.join(os.tmpdir(), "vaultix-host-recovery");
const done = (status, body) => { try { fs.unlinkSync(file); } catch {} process.stdout.write(JSON.stringify({ status, body })); };
try { fs.unlinkSync(file); } catch {}
fs.writeFileSync(file, code, { mode: 0o600, flag: "wx" });
fetch("http://127.0.0.1:8080/api/vx/v1/access/owner-password-reset-links", {
  method: "POST",
  headers: { "content-type": "application/json", "user-agent": "vaultix-server-owner-reset-link" },
  body: JSON.stringify(email ? { hostCode: code, email } : { hostCode: code })
}).then(async (r) => done(r.status, await r.json().catch(() => ({})))).catch((e) => done(0, { message: String(e && e.message) }));
`

func ownerResetLink(ctx context.Context, d *Docker, email string) (*PasswordResetLink, error) {
	backend, err := d.service(ctx, "backend")
	if err != nil {
		return nil, err
	}
	if backend == nil {
		return nil, errors.New("the backend is not running; start the instance first")
	}
	values, err := json.Marshal(map[string]string{"code": randomHex(32), "email": email})
	if err != nil {
		return nil, err
	}
	var out limitedOutput
	out.limit = 64 * 1024
	script := strings.NewReader(fmt.Sprintf(ownerRecoveryScript, values))
	if err = d.stream(ctx, script, &out, "exec", "-i", backend.ID, "node", "-"); err != nil {
		return nil, err
	}
	var response struct {
		Status int `json:"status"`
		Body   struct {
			PasswordResetLink *PasswordResetLink `json:"passwordResetLink"`
			Message           string             `json:"message"`
			Error             string             `json:"error"`
		} `json:"body"`
	}
	if err = json.Unmarshal(bytes.TrimSpace(out.Bytes()), &response); err != nil {
		return nil, errors.New("the application returned no readable answer")
	}
	if response.Status == 201 && response.Body.PasswordResetLink != nil && response.Body.PasswordResetLink.URL != "" {
		return response.Body.PasswordResetLink, nil
	}
	reason := response.Body.Message
	if reason == "" {
		reason = response.Body.Error
	}
	if response.Status == 404 && reason == "" {
		reason = "this application version has no owner recovery; upgrade the instance first"
	}
	if reason == "" {
		reason = fmt.Sprintf("the application answered %d", response.Status)
	}
	return nil, errors.New("owner recovery refused: " + reason)
}

func withOwnerResetLink(ctx context.Context, d *Docker, email string, result *Result) error {
	link, err := ownerResetLink(ctx, d, email)
	if err != nil {
		return err
	}
	result.PasswordResetLink = link
	result.Message = strings.TrimSpace(result.Message + " Open the link to set a new password for " + link.Username +
		". It works once and expires at " + link.ExpiresAt + ". It is a credential: give it only to that person, never paste it into chat or an AI tool.")
	return nil
}
