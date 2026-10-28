# Organization-first instance setup

The first-run correction is an in-place change to the application at `/`, not
another viewport. A new self-hosted instance asks for an organization name, then
creates its owner with the owner's chosen email and password, then opens the
existing organization dashboard.

## Behavior and preservation

- Suggest an editable organization display name. Explain that a business, team,
  brand, or personal workspace can use its own name and rename it later.
- Keep the existing server password policy, breached-password checks, password
  confirmation, hashing, session issuance, and organization creation services.
  There is no shared default password. Passwords remain in the account form;
  guide events contain only allowlisted identifiers and never field values.
- Set fresh self-hosted instances to invite-only and email/password sign-in in
  the account-creation service. Existing deployments are not migrated to these
  defaults. Public signup remains in Server Console General; authentication
  providers remain in Server Console Authentication and organization settings.
- Remove the repeated account/organization and public-access wizard from initial
  setup. `/admin/setup` remains as completion recovery for an already-created
  account and organization. It does not overwrite an existing access policy.
- After account creation, unmount password controls. Retry only organization
  selection/completion if opening the workspace fails. A later sign-in resumes
  the existing setup. The normal signed-in organization-name step also retains
  its created organization ID across selection failures within the mounted form.
- Add organization and owner lessons to the existing public guidance catalog and
  strict native renderer. Tooltips open contextual dialogs; focus can return to
  allowlisted controls. Teaching does not submit forms or establish success.
- Preserve existing UI/API routes and encrypted storage. No new identity runtime,
  tables, model API, external login provider, or secret-value AI transport is added.

## Acceptance

`scripts/test-first-run-setup.mjs`, invoked by the existing real-image application
harness, creates only a disposable owner through the browser. It checks the two
steps, editable suggestions, name validation, modal keyboard containment and
focus return, narrow-screen reflow, secure stored defaults, repeat-bootstrap
rejection, and dashboard arrival. Two deliberately failed completion PATCH
requests test retry and refresh recovery; account creation itself is real. The
existing harness then signs in again with the chosen password and exercises the
project, secret, environment, and authenticated dashboard workflows.

Evidence is emitted under `.cache/app-image-proof-*/onboarding-result.json` and
`onboarding-accessibility.json`, alongside existing workflow receipts. Canonical
build receipts identify the exact standalone image and source revision. A test
being present is not a passing result; record the completed receipt separately.
Automated accessibility checks do not establish manual screen-reader acceptance.

## Open work

The inherited bootstrap service still spans separate user, organization, and
configuration writes. Server-side concurrent first-owner requests and partial
transaction failure require a separate transactional design and acceptance;
client completion recovery does not solve these. Existing Nomen ownership and
native Go identity migration remain subject to their documented gates.

The remainder of product authorship follows 0021, 0027, and the capability plan
in 0049. These onboarding changes do not establish whole-product authorship,
enterprise feature parity, external-provider acceptance, or all-UI accessibility.

## Staged native project route correction

Inspection also found that the staged Go project-create handler returned a
fabricated project ID without persisting a project. It now returns an explicit
501 error to authenticated callers and requires identity. The active existing
`POST /api/v1/projects` workflow remains the production creation path. Integration
checks verify no write from the staged route and actual persistence through the
existing workflow. OpenAPI is regenerated from its specification. This is a
truthful migration boundary, not a completed Go project-domain migration.
