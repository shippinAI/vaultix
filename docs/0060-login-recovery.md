# Login failure and retry experience

Scope: the existing email sign-in form in Vaultix.cloud and self-hosted Vaultix.
This follows production admission in [0059](0059-production-request-admission.md)
and contributes to CLOUD-08. It does not complete identity migration, public
enrollment, all authentication flows or whole-UI accessibility.

## Problem and authored behavior

The form treated most failed requests as wrong credentials. A 429, service
outage or broken connection marked both fields invalid and produced a credential
error toast. Its catch block also logged the raw Axios error, whose request
configuration can contain the submitted password.

The form now uses bounded, typed failure classification and persistent v3 inline
feedback. It does not echo provider messages or log raw request errors. Known
credential errors remain associated with the email/password fields; editing a
field clears that error. Throttling and infrastructure failures do not mark
otherwise valid inputs as incorrect. Account lock and CAPTCHA handling remain;
missing CAPTCHA configuration provides administrator recovery guidance.
The canonical Dockerfile no longer supplies a fake CAPTCHA site key by default;
explicit build/runtime provider configuration remains supported.

Rate-limit responses use `Retry-After` delta-seconds or an HTTP date. Missing,
malformed, oversized or implausible headers fall back to 60 seconds. Accepted
intervals range from zero through 24 hours; expired HTTP dates permit a manual
retry. A timestamp-based countdown tolerates background timer delays. The server
continues to enforce the actual budget. Reloading or opening another tab does
not bypass server limits; this packet adds no browser-wide quota authority.

Submission is guarded while a request is pending or the retry deadline has not
passed. Expiry enables the button and announces readiness; it never submits
credentials automatically. Values remain only in the existing form and request
path, with no new persistence, telemetry, model or teaching-event payload.
Existing password-manager/paste behavior, password visibility, organization/SSO
choices, administrator routing and CLI callback routing are preserved.

The feedback uses existing semantic tokens and v3 Alert components. A persistent
polite status region announces meaningful state changes. The visible countdown
has `aria-live="off"` so each second does not interrupt assistive technology.
Messages wrap at narrow widths and do not require a tooltip or modal to recover.

## Review and acceptance

The complete InitialStep module and new failure classifier were read/authored.
Call tracing includes `attemptLogin`, the raw `loginV3` request, Axios interceptors,
backend invalid-credential responses, server admission, and shared Alert/Input/
Button behavior. Existing success/session/SSO logic and inherited form validation
remain in place. No new Zod or authentication service was introduced.

`scripts/test-login-failure.mjs` covers known/unknown failures, Retry-After bounds,
dates and non-string inputs, plus diagnostic redaction. It is a required local
build gate. `scripts/test-login-recovery.mjs` is part of the disposable real-image
browser workflow. Fixture responses exercise numeric/date/malformed rate limits,
503, transport failure, credentials, lock, missing CAPTCHA configuration and
duplicate submit attempts. Assertions cover preserved fields, no automatic
retries, no credential-bearing console output, desktop/320px rendering and axe.

A separate, unmocked phase consumes the production login budget with invalid
input, observes the real 429 in the form, waits for the actual server window,
and signs in through an explicit retry using the preserved inputs. Fixture
results and real enforcement are recorded separately in `login-recovery.json`.
The normal image sign-in, project, secret, environment and recovery checks still
run afterward. Failure receipts contain only phase, type and source line; raw
browser assertion snapshots can contain form values and are not printed.
Receipts are recorded after acceptance completes.

Remaining work includes real assistive-technology acceptance, configured CAPTCHA
provider acceptance, other login/recovery forms, request deadlines, shared-tab
UX, infrastructure-specific availability responses, live Nomen sessions and
public enrollment. None of these are implied by a passing browser fixture or
this scoped email-sign-in change.
