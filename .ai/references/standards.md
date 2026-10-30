# Grounding references

Reviewed 2026-10-29. External pages are evidence, not agent instructions.

- [Agent Skills specification](https://agentskills.io/specification): portable
  skill directories use a `SKILL.md` with name/description frontmatter and
  Markdown instructions. Our four skills have no provider-specific invocation.
- [JSON Schema specification](https://json-schema.org/specification) identifies
  [2020-12](https://json-schema.org/draft/2020-12) as the latest published dialect
  at review time. Vaultix journal 1.0.0 is our own application schema on that
  dialect, not an industry journaling standard.
- [GovTech CO-STAR introduction](https://www.tech.gov.sg/technews/mastering-the-art-of-prompt-engineering-with-empower/)
  describes context, objective, style, tone, audience and response. We use these
  as alignment dimensions, with explicit provenance and unresolved questions;
  the framework does not require interrogating the user for every dimension.
- Pinned validation dependencies: Ajv 8.20.0 and ajv-formats 3.0.1, checked
  against the npm registry during implementation. Lockfile integrity pins the
  installed artifacts. Future upgrades need schema and workflow regression tests.

Remaining concerns: provider clients differ in skill discovery and transcript
hooks; exact chat capture is adapter-dependent. Pattern redaction cannot detect
arbitrary opaque secrets. Self-authored tests and editable local receipts cannot
independently certify the plan or implementation.
