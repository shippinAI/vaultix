# 0007 — Vaultix owns the schema (forked from Infisical core)

**Status:** superseded (2026-08-29) by [0011-owned-engine.md](0011-owned-engine.md).
The dump that this doc forked now lives at [`leftover/schema-dump/`](../leftover/schema-dump/)
and is **not** the Vaultix store. Live tables are `vaultix_*` in
`panel/internal/vault`.
**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.
**Tree (leftover):** [`leftover/schema-dump/`](../leftover/schema-dump/)

## 1. Why

Vaultix is adding capabilities the upstream doesn't have (Doppler-class
layman UX, doc 0008). Owning the schema is the precondition: you cannot
extend tables you do not control. This is the DB-layer counterpart to the
panel rebrand (doc 0005) and the same move as Tradere owning its mail-fork —
run our own tree, not the vendor's image.

Licensing: per the operator's waiver and paid relationship with the
upstream, Vaultix may fork and rebrand. This tree is ours to extend.

## 2. What changed in the fork

The 320 tables are generically named (`secrets`, `projects`, `users`) — the
schema was **not** Infisical-prefixed, so this is ownership + branding, not
a 320-table rename. Every literal `infisical` string is gone (grep-verified
0 in `db/`):

| Was | Now | Note |
|-----|-----|------|
| `keySource` default `"infisical"` + paired CHECK `= 'infisical'` | `"vaultix"` | Changed as a **pair** (default + constraint) so the check stays valid. PKI tables (refused domain, doc 0003) — rebranded for consistency only |
| DNS `_infisical-verification.<domain>` TXT record | `_vaultix-verification.<domain>` | **User-facing** — this is the record we tell customers to create |
| `LICENSE_SERVER_URL` default `portal.infisical.com` | `""` | Killed the phone-home. Private waivered fork needs no license server |
| boot message + comments naming Infisical | Vaultix | cosmetic |

## 3. The state this leaves us in (read before deploying)

**The forked schema is ahead of the running engine.** Today Vaultix still
runs the upstream `infisical/infisical:v0.162.19` image (compose), which
ships its OWN migrations and writes `keySource='infisical'`. Our rebranded
schema is **not yet what runs** — it is the tree our own backend build will
run, exactly as Tradere forked+built its own binary rather than running
a vendor image.

So the sequence, same as Tradere:
1. **Schema fork (done, this doc):** own + rebrand the migrations/schemas.
2. **Backend fork (next):** build our own Vaultix backend image from the
   core, running THIS schema. Until then the `keySource`/verification
   rebrand lives only in our tree, not the live DB.
3. **Cutover:** swap compose from the upstream image to the Vaultix build;
   the rebranded values become live. A data migration maps any existing
   `keySource='infisical'` rows to `'vaultix'` at cutover.

Do not point the current upstream image at this rebranded schema — the
values would mismatch its app-layer expectations until step 2 lands.

## 4. Extending it

New capabilities (doc 0008) add migrations here with a `vaultix_`-free,
consistent naming style matching the existing generic tables. New tables go
through the same `TableName` enum + schema-file pattern the tree already
uses. The `db/` tree is the canonical schema authority from now on.
