# Application entry and owned artwork

The 2026-10-27 correction restores the existing core application as the product.
The earlier root guide page displaced the expected login and project entry.
Passing guide tests did not establish that the actual application loaded.

## Routing

`pages/index.tsx` redirects to `/login`. The existing `restrict-login-signup`
middleware resolves first-instance setup, login, organization selection, and
authenticated project navigation. Protected routes still use `authenticate`
and `inject-org-details`; no token, permission, MFA or tenant check is removed.
The existing project, secrets, certificate, KMS, scanning, PAM and admin routes
remain in the original route tree. This does not establish Nomen integration.

The optional catalog/reference/AI guide moves to `/help`. The application Help
menu links to it. It is not a separate secrets application or a substitute for
the existing engine UI. The header no longer advertises a paid software trial.

## Artwork

Owned flat vector assets are `vaultix-mark.svg`, `vaultix-wordmark.svg`,
`vaultix-loading.svg` and `vaultix-social.svg` under `core/frontend/public/images`.
The social PNG is rendered from that SVG; the favicon uses the same vault mark.
The auth header and application navigation display the same mark. Shared-secret,
OAuth consent and error screens use the owned mark/wordmark. Existing social
metadata references now point to the actual Vaultix PNG, replacing a missing
`message.png` path.

The inherited logo PNGs still contained the old infinity mark and name despite
their Vaultix labels. Those assets, unused mascot/update artwork and inherited
loader GIF/Lottie files are removed from the public payload. Shared loading
controls render the owned vector loader, whose animation respects reduced motion;
legacy integration loading images use that same asset. Other Lottie icons keep
their existing behavior. Integration-provider logos retain their provider identity.

`scripts/check-owned.sh` now checks authored assets and retired image references,
in addition to visible source text. A text-only rebrand check is insufficient for
binary images. The existing module-by-module authorship ledger remains separate;
updating an image path does not count as reviewing the whole consuming module.

## Verification

`scripts/test-native-ui.mjs` verifies root-to-login and first-instance setup,
then the optional help flows and sign-in layouts. It uses fixtures and retains
that distinction in its output.

`VAULTIX_IMAGE_APP_PROOF=1 bash scripts/smoke-image.sh IMAGE dragonfly` runs
`scripts/test-image-app.mjs` against the disposable smoke instance. The runner
refuses initialized instances, creates a random test-only account, completes
instance configuration through the API, and signs in through the real browser
form. It verifies the organization dashboard, authenticated root navigation,
and anonymous denial. No application/authentication responses are mocked. The
smoke runner removes its own test containers afterward; it never uses the
operator's local development database. Browser screenshots and results are
retained in `.cache/app-image-proof-*` and by GitHub Actions.

This acceptance scope does not establish all authenticated features, external
identity/provider integration, screen-reader conformance or enterprise parity.
