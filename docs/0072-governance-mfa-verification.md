# Organization MFA interaction verification

2026-10-30, GOV-UI-01. Implements the first control in [0071](0071-devscif-governance-experience.md), inside the existing organization Settings > Security workflow.

Source: `def9b6b2012f73245aebaa61d781a8aac467d142`. Canonical standalone image:
`sha256:9003c44f44cf9516de4d974e9acb8e76ca9543d63401abb49557877e26307f28`. Built locally from committed LF source using
`core/Dockerfile.standalone-vaultix`. Receipt-only documentation does not change
the tested runtime source.

## Observed acceptance

- Full frontend TypeScript and scoped MFA ESLint passed.
- All 16 canonical build/application gates passed, retaining the existing source checks, real setup/login/project/secrets workflows, Dragonfly and Redis smoke checks, encrypted recovery, tenant isolation, proxy boundary and production-admission checks. These are disposable local checks, not public-cloud qualification.
- Real MFA settings: draft/cancel produced no writes; method-only save persisted across reload; missing-SMTP enforcement was rejected by the server; anonymous mutation received HTTP 401 and a plain error.
- Separately injected UI fixtures: HTTP 503 retained the draft, a delayed retry kept controls disabled while the real request completed, and read-only permissions disabled all edit controls. These are not a substitute for live provider or authenticated non-admin API acceptance.
- Browser checks covered keyboard dialog focus/return, hover/focus/touch-accessible help, one error notification, exact changed-field payloads, 320px reflow and reduced motion. Five selected axe scans reported zero violations; automated scans do not establish whole-workflow accessibility.

The rendered checks exposed and led to corrections for low-contrast descriptions
in the MFA and session-length cards and an off-screen mobile method menu. Failed
receipts remain in the journal. The default Select positioning is used for MFA;
shared Select behavior was not changed.

The MFA control no longer offers a paid-upgrade gate. Existing API authorization,
SMTP requirements, factor enrollment and Nomen authority are unchanged. Observed
stale drafts are refused; the existing API still lacks an atomic policy revision
precondition. Complete concurrency protection requires service work.

## Evidence and limits

Local evidence is under `.cache/headless-ai-login/`:

- `.cache/self-hosted-build-Dv9TuV/result.json` binds source, image and all build gates.
- `.cache/governance-acceptance.json` binds the journal plan and application reports.
- `.cache/app-image-proof-gIOpWj/workflow-result.json` retains the complete packaged application run.
- `.cache/app-image-proof-gIOpWj/org-mfa-workflow.json` records real/fixture outcomes, safe policy payloads and accessibility findings.
- Independent settled visual captures are .cache/governance-desktop.png and .cache/governance-mobile.png, bound by .cache/governance-visual.json. The desktop harness capture caught a resize transition; the separate capture confirms the settled layout.
- The same browser evidence folder contains `org-mfa-security.png` and `org-mfa-review-mobile.png`.
- Journal `2026/10/e3c73b19-1c5c-4b03-8b5b-912f591a4e6a` retains planning, source fingerprints, research, failed attempts and final receipts. Intermediate conversation capture is explicitly summarized where exact text was not retained.

Live SMTP and factor sign-in, manual assistive-technology acceptance, other
security controls, full DevSCIF services, Nomen native cutover, hardware/provider
profiles and public-cloud acceptance remain open. The service workstreams in
0071 are a delivery map, not a claim that those services were newly implemented.
