# platform/

Two trees, one rule.

| Folder | What it is | Who gets it |
| --- | --- | --- |
| `engine/` | The Vaultix product: secrets engine, UI, API, Go service. Every software feature. | Every deployment, self-hosted and hosted. Never gated. |
| `shippin/` | The commercial cloud service around the engine: customer sign-up, one instance per customer, fleet operations, billing, quotas, off-site backup scheduling. | Only the service AngryVibes LLC operates. |

**The rule:** `shippin/` may depend on `engine/`. `engine/` never depends on `shippin/`.
`node scripts/test-platform-boundary.mjs` fails the build when that is broken.

`platform` is a folder name, not a tier. Nothing under `engine/` is paid.

## Known debt

`engine/backend/src/shippin` and `engine/backend-go/internal/shippin` are older folders that share
the name but live inside the engine and are imported by it. They are not the commercial boundary.
Each one is sorted during its domain's port ([0122](../docs/0122-completion-plan.md) Stage 7):
product features move into their engine domain folder, and only code that is truly commercial
moves to `platform/shippin/`. The boundary test holds the number of engine files importing them
at its recorded ceiling so it can only go down.
