# AUTH-03 A protocol verification

Date: 2026-10-30. Scope: the unmounted native Nomen introspection component in
`core/backend-go/internal/services/auth/nomen/` and the
[researched execution plan](nomen-execution-plan.md). This is one part of AUTH-03;
account binding, tenant authorization and public source-action integration remain open.

Source candidate: `418e8adac22bc2ff01d3277e773fe4a12e7f9462`.
Canonical image: `sha256:8f62eb0de6c0c93e89d70f62d8cbf9d9193f49ea3d337a692c8c4716ae8a0370`.
Native Go test runner: `sha256:e13b57dc548f50bcff7b122ebc059e69b7f164e552f534c600c844c6ade92b4b`.
Later documentation/evidence commits leave the runtime source identical.

| Check | Observed evidence |
| --- | --- |
| Native internal Go suite | 787 passing test/subtest outcomes with race detection, including 54 Nomen outcomes; zero failed/skipped tests. 22 packages report no tests under this invocation. This is not the DB integration-tag suite. |
| Protocol boundary | Actual TLS requests, Basic form encoding, independently verified RSA client assertions, pinned discovery, wrong issuer/audience/client/type/expiry denial, malformed/duplicate claims, redirect/timeout/body/close failure, cancellation, concurrency and recovery. Fixture tokens only. |
| Falsifying control | Removing only the issuer equality guard in a disposable container made the specific wrong-issuer test fail at its acceptance assertion. The production checkout and archived source were not modified. |
| Pinned lint | golangci-lint 2.15.0 with integration build tag: zero issues. Existing deprecated-exhaustruct warning remains. Initial Close-error handling failed lint and was corrected before acceptance. |
| Canonical artifact | Built from LF committed source with core/Dockerfile.standalone-vaultix; image identity/revision passed. Runtime filesystem layers exactly equal the previously accepted CLI candidate image, so its 16 application/build gates remain relevant to the unchanged runtime. Those gates were not re-run or represented as new protocol/login evidence. |
| Plan/source accounting | All 86 catalog IDs accounted for; 22 exact source blobs with explicit full/scoped/prior-review distinctions; local links and audit/migration/capability maps passed. Owned-source/branding check passed. Inventory is not authorship. |

Private local receipts are under `.cache/headless-ai-login/.cache/`:
`nomen-execution-acceptance.json`, `nomen-native.json`,
`nomen-component-build.json`, and the retained failed
`nomen-native-b685ce10-failed-lint.json`. The immutable local journal is
`2026/10/b82274ff-7daf-44c9-a527-21d85b3088cc`; it records source-bound plan
revisions, research, corrected failures and executed verification receipts.
The check runner validates consistency of those local receipts, not independent
attestation or adequacy of the whole product plan.

No Nomen credentials were used. Public discovery is not client registration or
human approval. The component is not imported into production route registration;
it cannot create a Vaultix actor, organization grant or session. ID/refresh-token
substitution against the actual issuer, durable subject binding, account/MFA/tenant
policy, native projects/references/MCP ownership, all existing CLI secret commands,
Windows keyring and live refresh/revocation remain separate gates in the plan.

No public deployment or new UI workflow was performed by this packet. The existing
local preview/data remain available. Software feature parity, whole-UI accessibility,
public-cloud readiness and DevSCIF profile acceptance are not established.
Next: AUTH-03 B binding migration and audited linking, then C actor policy and AUTH-04.
