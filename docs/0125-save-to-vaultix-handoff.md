# 0125 — Save to Vaultix: browser handoff from a partner application

Status: implemented 2026-11-13, version 1. Applies the rule of
[0124](0124-ai-personas-and-machine-loops.md): a sensitive value only exists in the browser at
the moment a person submits it. Nomen stays an optional provider
([0070](0070-nomen-authority-contract.md), [0074](0074-built-in-and-federated-identity.md)):
nothing here lets a Nomen token reach the engine API.

Contract: [`contracts/vaultix.save-secret-handoff.v1.json`](../contracts/vaultix.save-secret-handoff.v1.json).

## What it does

A partner application (Nomen first) shows a one-time credential, such as a new client secret,
and offers **Save to Vaultix**. The value goes from the partner's page to a Vaultix popup in the
same browser and is stored with the person's own Vaultix session. No server of either product
talks to the other, and the value never travels in a URL.

1. The partner opens a popup (never an iframe):
   `<SITE_URL>/integrations/save-secret?v=1&source=nomen&origin=<partner origin>&name=<suggested name>&kind=<kind>&nonce=<nonce>`.
   `kind` is one of `password`, `client_secret`, `pat`, `recovery_password`, `machine_key`,
   `other`. `nonce` is 22–43 base64url characters with at least 128 random bits.
2. Vaultix checks the request: `v=1`, `origin` exactly in the operator's allow-list, a valid
   nonce and kind, and no other parameters. Otherwise it shows an error and posts nothing. The
   name is only a suggestion: it is trimmed, whitespace, colons and slashes become underscores,
   and the person can edit it.
3. If the person is not signed in, Vaultix sends them through its normal sign-in and back to the
   same URL. The return target is followed only as a same-origin relative path.
4. Signed in, Vaultix posts `{type: "vaultix.save-secret.ready", v: 1, nonce}` to
   `window.opener`, with `targetOrigin` set to the validated origin. Without an opener it shows
   an error.
5. Vaultix accepts exactly one `{type: "vaultix.save-secret.value", v: 1, nonce, value}` whose
   `event.origin` is the validated origin and `event.source` is `window.opener`, with a non-empty
   string of at most 64 KiB. Everything else is ignored. The value stays in memory in that
   window: not in storage, the URL, logs, telemetry or error reports.
6. The person picks the organization, project, environment and folder (the last choice is
   remembered for them, without the value) and confirms the name. **Save** calls
   `POST /api/v4/secrets/:secretName` with their session, so permissions and approval policies
   apply. **Cancel** stores nothing.
7. Vaultix posts exactly one
   `{type: "vaultix.save-secret.result", v: 1, nonce, status, secretName?, version?}`, clears the
   value and offers to close. `status` is `fulfilled` (with name and version), `approval` (a
   change request waits for approval), `declined` (cancelled, or the window closed) or `error`
   (a save failed and the person stopped). The value is never posted back.

## Operator setting

`VAULTIX_INTEGRATION_ORIGINS` is a JSON array of exact origins, for example
`["https://nomen.example.com"]`. Each entry is written exactly as `window.location.origin`
writes it: https, or plain http only on `localhost`, `127.0.0.1` or `[::1]`; no path, trailing
slash or default port; at most 32. An invalid value stops Vaultix at startup with the reason.
Unset or `[]` turns the feature off. The list reaches the browser through
`GET /api/v1/admin/config` as `integrationOrigins`. It is in `compose/*.env.example`.

## Headers

`/integrations/save-secret` is served with `Content-Security-Policy: frame-ancestors 'none'`,
`X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`, and with
`Cross-Origin-Opener-Policy: unsafe-none`. The rest of the application keeps
`same-origin`, which would cut the popup off from a partner opener.

## For partners

- Open the popup with `window.open`, keep the reference, and send the value only after a ready
  message with your nonce arrives from the Vaultix origin, to `targetOrigin` = the Vaultix
  origin.
- Your page must not send `Cross-Origin-Opener-Policy: same-origin`; use
  `same-origin-allow-popups` or leave it unset, or the popup loses its opener.
- Treat the popup closing without a result as declined. Use a new nonce for every attempt.

## Limits

- Sign-in that leaves the page for another document (OIDC, SAML or another provider, including
  Nomen as a provider) loads pages with `Cross-Origin-Opener-Policy: same-origin`, which severs
  the opener. Vaultix then says the window is not connected to the partner, and the person
  starts again from the partner, now signed in. Email and password sign-in keeps the opener.
- The secrets API has not moved to `/api/vx/v1` yet ([0119](0119-schema-and-api-namespaces.md)).
  When it does, the page moves with it in the same change; the contract does not change.

## Evidence

- `scripts/test-save-secret-handoff.mjs`: request validation, message filtering, the save call,
  result messages, value hygiene, the contract against the implementation, the return path.
- `platform/engine/backend/src/lib/config/integration-origins.test.ts` and
  `src/server/plugins/serve-ui-headers.test.ts`: the allow-list and the route headers.
- `scripts/test-save-secret-handoff-image.mjs`: a real browser against a disposable stack from
  the image, with a partner page on an allow-listed loopback origin.
