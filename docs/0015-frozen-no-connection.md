# 0015 — Frozen snapshot. No connection.

**Status:** accepted (2026-08-29). Operator. Cut executed.

Vaultix is AngryVibes LLC / **shippin.ai** secrets. We own the engine
(`panel/internal/vault`, `vaultix_*`). There is **no fetch, no clone, no
remote, no phone-home** to a snapshot host. That was the promise.

## 1. No connection

| What | Rule |
|------|------|
| `leftover/consider-upstream.sh` | Refuses. No URLs. No host. Exit 2. |
| `git clone` of a snapshot repo | Forbidden. Inventory README does not instruct it. |
| Phone-home (`portal.*` / `app.*` of the snapshot host) | Empty. Viewport tests fail if that brand appears. |
| Community / hosted pack | Our compose + our binary. No fetch script. |

The dump in `leftover/` is frozen files we may **read**. We do not go
back for more. We do not run that image.

## 2. Chrome we ship

| Path | Ships as Vaultix? |
|------|-------------------|
| `panel/` | **Yes.** Ours. A2UI + catalog. |
| `branding/`, `compose/`, `contracts/`, `docs/` | Yes |
| `leftover/` | **No.** Frozen dump. Not customer copy. Not a fetch source. |

Do not wrap leftover UI as `/viewport/`. Do not point compose at a
leftover product image.

## 3. Check

`./scripts/check-owned.sh` — fetch script has no host and refuses;
leftover shell has no snapshot GitHub URL.
