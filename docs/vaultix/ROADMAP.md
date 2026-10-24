# Vaultix roadmap

**Status:** direction (2026-10-22)
**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.
**Honesty:** Vaultix is sold as secrets you can leave. Shippin manages them, or an operator runs the same archive on a VM or a laptop. No seat meter. No license phone-home.

This plan sits on the owned engine (`core/`, Infisical MIT pin **v0.162.19**) and the overlay (`panel/`). Production at secrets.shippin.cloud still runs Infisical **v0.166.8**. The pin does not contain 0.163–0.166. Gap notes below come from the `ee/` inventory in this tree, docs 0003 and 0013, and the public Infisical and Doppler product surfaces. They are not a line-by-line diff against v0.166.8.

**Waiver.** Shippin / AngryVibes LLC (dba wiredFRONT) operates `core/backend/src/ee/` and the Go `ee` packages under a waiver from Infisical, after a donation. The waiver text is not in the repo. The record is `NOTICE`. Infisical’s license files stay intact. We keep those features and build on them. We do not strip `ee/` and we do not clean-room rewrite it. Vaultix becomes a different product through what Shippin adds (honest exit, Doppler-style ergonomics, onboarding), on top of that engine. Panel valves still open only with a Vaultix grant (doc 0013). `LICENSE_SERVER_URL` stays empty. The waiver is not a phone-home key.

Effort below is change size, not a calendar. **S** is one package plus tests. **M** is API, CLI, and a screen. **L** is schema or crypto behavior plus a migration of operator habits.

## What Infisical Cloud has that self-hosted v0.166.8 does not hand you

Self-hosted MIT already has projects, environments, folders, secret versions, machine identities, universal auth, a CLI, and many sync connectors. The gaps below are what their cloud or their enterprise license keeps. Names match the modules under `core/backend/src/ee/services/` on this pin.

| Their gate | What the buyer feels | Where it lives on this pin | Vaultix answer | Risk |
| --- | --- | --- | --- | --- |
| Cloud seat and project caps | Free cloud stops at a handful of people and projects | Not in MIT. Doc 0003 keeps the meter off | Community stays unlimited. The panel meter exists and stays off | Low. Do not turn it on |
| SAML, SCIM, LDAP, OIDC add-on | “Log in with the company IdP” | `ee/services/saml-config`, `scim`, `ldap-config`, `oidc` | Keep these modules and extend them. Nomen stays Shippin’s login. Do not add a second SAML stack beside theirs | **High** only if a parallel implementation appears |
| Access approval, secret approval, access requests | Someone must say yes before a prod key is readable | `access-approval-*`, `secret-approval-*` | Keep the ee services. The panel `approval-gate` sits on inject and stays closed until an enterprise grant | Medium. The policy engine must fail closed |
| Secret rotation product | Keys expire without a human pasting the new one | `secret-rotation-v2` | Keep the ee rotator. Lessons teach it | Medium. A wrong rotator writes the new key and loses the old one |
| Dynamic secrets | A database password that dies | `dynamic-secret`, `dynamic-secret-lease` | Keep the ee leases. Short-lived inject tickets stay the vibe-coder path on top | **High.** A lease that fails open leaves a credential alive |
| Audit stream to a SIEM | “Who read prod” | `audit-log-stream` | Keep the ee stream. Panel valve `audit-stream` stays grant-gated | Low |
| Point-in-time recovery | They deleted the wrong key at 14:02 | `pit` | Keep PIT. The encrypted backup in this roadmap is the portable exit beside it | Medium. A restore that mixes two tenants is worse than no backup |
| Trusted IP, rate limit | Office CIDRs, abuse caps | `trusted-ip`, `rate-limit` | Keep the ee controls. Valves `ip-allowlist` and `rate-cap` stay grant-gated | Low |
| Custom roles | Admin vs CI vs builder | Partly MIT, partly the `ee` permission service the process already imports | Keep that permission service and extend it in place. Nomen scopes still name the person | **High.** Replacing it would break boot. Do not transcribe it into a second engine |
| Sub-organizations | Agency with many customers | `sub-org` | Keep sub-org. A shared-database tenant is still one table prefix | Low for prefixes. High if two org models diverge |
| Gateway, relay | Private network in front of the vault | `gateway`, `gateway-v2`, `relay` | Keep the ee gateway. Zuul and Caddy stay the Shippin mesh in front | Medium. Two front doors can skip each other |
| HSM, KMIP, external KMS | Root key in a hardware module | `hsm`, `kmip`, `external-kms` | Keep them. Software root key stays the default. Do not change wrap behavior until an estate asks | **High.** A wrong wrap destroys every secret |
| PAM, certificate manager | Session brokering and a cert SKU beside the vault | `pam-*`, large `pki-*` set | Keep them in the tree. Secrets stay what we lead with. Shippin mesh certs stay step-ca / Caddy | **High** operational surface. Extend only when a member asks |
| Honey tokens, insights | Tripwires and dashboards | `honey-token`, `insights` | Keep them. Extend when a member asks | Medium. A honey token that looks like a real key will get used |
| Secret scanning of customer git | Cloud GitHub App reads repos | Cloud wiring plus scanning services | Keep the engine’s scanner. Do not phone their app. Surface findings in plain words | Medium. Privacy of the repo contents |
| Hosted sync runners and email | They run the worker | Cloud-only operations plus the connectors already in the tree | Those connectors stay. Shippin runs them only on hosted SKUs the operator asked for | Low |
| Product chrome and license server | The UI says Infisical and calls home | Detach PR | Vaultix name, empty license server, telemetry off | Low. Already in progress |

v0.166.8 may have moved a few of these after our pin. We do not fetch upstream to check (`docs/0015-frozen-no-connection.md`). Features already in this tree, MIT or `ee/`, stay. New Shippin behavior is added beside them.

## What Doppler does better

Doppler is a managed service. Since June 2026 it also sells an on-prem install, Enterprise only, with no public install docs. Free self-hosting is still our opening, not a defect to copy. Where they win today:

| Doppler | Why it feels better | Vaultix fold-in |
| --- | --- | --- |
| Config inheritance and personal branch configs | `dev_alice` inherits `dev` inherits `base`. One change in base shows up everywhere it should | A config graph in our CLI and panel. Child keys override parent keys. Import Doppler’s graph instead of flattening it away |
| Secret references | `${other.KEY}` instead of pasting the same token into six configs | Resolver in `vaultix run` and on import. Values stay out of argv and out of GET |
| `doppler run -- cmd` | The command line people already teach each other | `vaultix run` already injects a local scope. Add `--config`, inheritance, and reference expansion so the ergonomics match |
| Workplace import | Paste a token, projects appear | Doppler API token import: projects, configs, computed secrets. Counts come back. Values do not |
| Onboarding that finishes | A checklist, not a schema lecture | First screen for a vibe coder: name the app, put one key, run one command. Design below. Built in slices |
| Activity and stale-secret health | “This key has not changed in 200 days” | Plain-language activity and a health scan over `updatedAt`. Engine data exists. The screen does not. Later slice |
| Change requests | A diff someone approves | Our approval valve, then a diff screen. Later slice |
| Sync that looks like a toggle | Connect AWS, it stays connected | One-click flow over the MIT connectors that already exist. Later slice |

We do not copy Doppler’s seat math, their referral program, or their hosted-only assumption.

## Gaps this roadmap did not list (inventory 2026-10-24)

Checked against the sourced inventory in [`../references/2026-10-24-doppler-infisical-inventory.md`](../references/2026-10-24-doppler-infisical-inventory.md).
Infisical upstream is at v0.167.2; our pin stays v0.162.19 and production stays v0.166.8 until a reviewed upgrade.

| Gap | Who has it | Vaultix answer | Size |
| --- | --- | --- | --- |
| Branch and personal configs (`dev_alice` off `dev`) | Doppler, all plans | Part of row g: a personal child config per member, inheriting its parent | M |
| Typed values and restricted visibility | Doppler | Type and visibility on the secret record; restricted values never render again, inject only | M |
| Redact history | Doppler | Owner can redact past values of one secret; versions keep metadata | S |
| Offline fallback snapshot | Doppler (passphrase file), Infisical (proxy cache) | `vaultix run --fallback`: the encrypted local store already exists; add a passphrase-sealed export for images | S |
| Share links and secret requests | Doppler Share; Infisical sharing + requests | Covered by "AI needs a secret" below; plain share links ride on the same one-time page | M |
| Agent credential brokering | Infisical Agent Vault (paid per request) | Inject redeem already keeps values out of the model; add a broker that attaches the credential on the outbound call, free | L |
| Machine auth for CI and clouds | Infisical (k8s, AWS, GCP, Azure, OIDC/JWT, SPIFFE, TLS) | Keep the engine methods; document GitHub Actions OIDC first | S |
| Event stream | Infisical SSE (Ent), Doppler webhooks | Events free on every instance: requested, approved, denied, injected, rotated; feeds approvals and agents | M |
| SDKs, k8s operator, CSI, Terraform | Infisical (9 SDKs), Doppler (2) | Keep the engine's; publish under Vaultix names after the brand slice | M |
| Compare across environments, value search | Both | Row h | M |

## AI first: what neither of them does

1. **"AI needs a secret" requests.** An agent files a request by name and purpose. The owner gets a
   push, opens one Vaultix page, enters or picks the value and confirms with a passkey. Vaultix stores
   it and hands it straight to the command that needs it (inject redeem). The agent receives an event
   ("provided", "used"), never the value. No secret ever passes through chat.
2. **Import from where tools already keep credentials.** `vaultix import --scan` runs on the user's
   machine and lists what it finds, names and masked values only: project `.env` files,
   `~/.aws/credentials`, `~/.config/gh/hosts.yml`, `~/.npmrc`, `~/.docker/config.json`,
   `~/.git-credentials`, `~/.netrc`, `~/.kube/config`, SSH keys, the Claude Code and Codex credential
   files, Windows Credential Manager and the macOS keychain (with the user's permission). The user ticks
   what to keep; Vaultix creates the secrets in the right project and environment and can replace the
   plaintext files with `vaultix run` injection, keeping a backup. Nothing leaves the machine except
   the values approved. AI subscription sign-ins are stored as a backup for that user only, never
   reused by another tool.

## Honest exit

A tenant on shared shippin.cloud (one Postgres, table prefix `vx_<shortid>_`) can leave with the same archive a dedicated VM uses.

1. Export that prefix only, plus the root key material sealed inside the archive.
2. Import onto a fresh instance. The destination prefix may be empty (dedicated database) or a new prefix.
3. Re-wrap the software root key (`kms_root_config.encryptedRootKey`) from the old `ENCRYPTION_KEY` to a new one. The cipher is AES-256-GCM, IV || ciphertext || tag, the same layout the MIT engine already uses. We do not reimplement HSM wrap.
4. `compose/vaultix.yml` is the self-host path. They run it. Shippin is then optional.

Redis queues and cache are not in the archive. Secret bytes live in Postgres. A restored instance starts with an empty Redis and the same secrets.

## Readable tenant prefixes

Shared-database mode (`VX_ISOLATION=prefix`) uses one prefix per tenant: `vx_<shortid>_`. `<shortid>` is 1–8 characters, lowercase letters and digits, so the stem fits the engine’s 11-character limit. Example: `vx_ab12_organizations`, `vx_ab12_secrets_v2`, `vx_ab12_vaultix_migrations`.

The manager shows that prefix and the physical names. A person can see which tables belong to which tenant without reading SQL. A dedicated instance leaves the prefix empty and owns the whole database. An older stem still runs, and the manager says it is not the readable form.

## Login is Nomen

`vaultix login` is a device-code flow against Nomen (Zitadel OIDC). The CLI prints a browser link and a short code. The user signs in once. The CLI stores the access token in the keyring and does not ask for a password or a pasted token.

Nomen is the identity provider for Vaultix by default (`NOMEN_OIDC_ISSUER`, hosted default `https://auth.shippin.ai`), so Shippin and wiredFRONT services share one community identity. The same binary answers as `infisical` when installed under that name. Machine identities keep `login --universal` (client id and secret on stdin). That path is for workloads, not for people.

## Vaultix looks like Vaultix

The panel is the product surface: light paper, one copper accent, one column, the next command in a copyable line. That is the Doppler lesson (finish the task, name the config, show the command) in Vaultix colors and the Vaultix wordmark. The engine’s React app stays until a later slice replaces a screen. No second vendor’s chrome.

## Infisical Cloud import

Infisical Cloud does not hand over a `pg_dump`. Two ways in, both counts-only on the way back:

1. An export JSON (projects, environments, folders, secrets) applied onto this instance.
2. The machine-identity API pull already on `POST /api/v1/vaultix/link` and `POST /api/v1/vaultix/import`.

Values are written into the vault. The report lists how many projects, environments, and secrets moved.

## Onboarding design (build this before a visual rewrite)

The core React app stays the engine UI until slices replace screens. The first surface people see is the panel, not a 200-item settings tree.

**First visit, one column, three steps.**

1. **Name the app.** One field. Creates one project. Copy says “one box for every key this app will ever need.”
2. **Put a key.** One name, one value, one environment (`dev`). The value is not shown again on this page. The next screen lists the name only.
3. **Run it.** A single command: `vaultix run --config dev -- npm run dev`. A short note: the value is in the child process environment, not in the chat and not in the shell history we print.

Visual rules for the slice:

- Vaultix wordmark, “A SHIPPIN.AI SERVICE”, AngryVibes LLC. No other vendor name.
- One primary button per step. Plain sentences. No project/environment lecture above the form.
- Light, quiet page: lots of space, one card, system font. Progress is “1 of 3”, not a percentage gamified against a plan.
- After step 3, the existing viewport (`/viewport/`) and the lesson ladder (doc 0002) take over. Clyffy drives later lessons. This page does not embed a model.

Later slices, each its own PR: stale-secret health, activity in plain words, config compare, sync toggle. Not this page.

## Phase 2 queue

Each row is its own pull request.

| | Work | Size | Depends on |
| --- | --- | --- | --- |
| 0 | Detach phone-home and `DB_TABLE_PREFIX` | L, in review | — |
| 1 | This roadmap | S | — |
| a | Readable prefixes `vx_<shortid>_`, shown in the manager with the physical table names | S | The prefix rewriter |
| b | `vaultix login` device flow via Nomen. `infisical` argv0 and `--universal` stay | M | — |
| c | Vaultix visual system on the panel, including the three-step welcome | M | The design above |
| d | Infisical Cloud import: export JSON, and the machine-identity API pull | M | Counts only. Cloud has no `pg_dump` |
| e | Encrypted backup and restore for one prefix or a dedicated database | M | Prefix rewriter for prefixed dumps |
| f | Portability: same archive, destination prefix, root-key re-wrap, compose self-host | M | Backup |
| g | Doppler ergonomics: inheritance, references, `vaultix run --config`, Doppler token import | M | CLI that already exists |
| h | Health scan, activity, compare, sync toggle | M each | Welcome page can link them |
| i | "AI needs a secret" requests: request, push, one-time page, inject, events | M | Inject redeem, push channel |
| j | `vaultix import --scan` with review and file replacement | M | CLI store |
| k | Event stream on every instance | M | — |
| 7 | Extend `ee/` features in place where a Shippin flow needs them | L | Waiver in `NOTICE`. Do not replace the permission service |
| Parked | HSM / KMIP wrap changes, a second SAML stack | — | The modules stay. Wrap changes and a parallel IdP wait for a reviewed reason |

## What we will not do

- Strip `ee/`, relicense it, or clean-room rewrite a feature the waiver already covers.
- Put the waiver text in the repo, or edit Infisical’s license files.
- Open enterprise valves with an env flag when the grant is community (doc 0013).
- Put secret values on GET, in the roadmap UI, or in import reports.
- Reintroduce cloud seat caps.
- Fetch Infisical to “catch up” to v0.166.8 inside this tree.
