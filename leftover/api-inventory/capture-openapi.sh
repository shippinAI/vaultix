#!/bin/bash
# Capture the OpenAPI spec from a running Vaultix core.
# Usage: capture-openapi.sh [base-url] [out.json]
set -euo pipefail
BASE="${1:-https://vaultix.shippin.cloud}"
OUT="${2:-openapi.json}"
curl -fsS -m 30 "$BASE/api/docs/json" -o "$OUT"
python3 - "$OUT" <<'EOF'
import json, sys
spec = json.load(open(sys.argv[1]))
n = sum(1 for ops in spec["paths"].values() for m in ops if m in ("get","post","put","patch","delete"))
print(f"captured {spec['info'].get('version','?')}: {len(spec['paths'])} paths, {n} operations")
EOF
