#!/bin/bash
# Rename Infisical MIT pin to Vaultix in customer chrome and operator-visible
# copy. Do not rename npm packages (@infisical/...) or the RDP wasm import —
# those would break the build. Customer chrome must not say Infisical.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="$ROOT/core"
test -d "$CORE/frontend" && test -d "$CORE/backend"

cd "$CORE"
git remote remove origin 2>/dev/null || true
git remote | while read -r r; do git remote remove "$r" 2>/dev/null || true; done

# Owned schema overlay
if [ -d "$ROOT/db/schemas" ]; then
  rm -rf "$CORE/backend/src/db/schemas" "$CORE/backend/src/db/migrations"
  cp -a "$ROOT/db/schemas" "$CORE/backend/src/db/schemas"
  cp -a "$ROOT/db/migrations" "$CORE/backend/src/db/migrations"
fi

# Brand files — replace leftover vendor chrome, keep internal names working
cp "$ROOT/branding/favicon.svg" "$CORE/frontend/public/favicon.svg"
cp "$ROOT/branding/favicon.svg" "$CORE/frontend/public/infisical.ico"
cp "$ROOT/branding/mark.svg" "$CORE/frontend/public/images/logotransparent.svg"
cp "$ROOT/branding/wordmark.svg" "$CORE/frontend/public/images/gradientLogo.svg"
cp "$ROOT/branding/wordmark.svg" "$CORE/frontend/public/images/biglogo.svg"
cp "$ROOT/branding/mark.svg" "$CORE/frontend/public/images/integrations/Infisical.png" 2>/dev/null || true
cp "$ROOT/branding/mark.svg" "$CORE/company/logo/dark.svg"
cp "$ROOT/branding/mark.svg" "$CORE/company/logo/light.svg"
cp "$ROOT/branding/wordmark.svg" "$CORE/img/logoname.svg"
cp "$ROOT/branding/wordmark.svg" "$CORE/img/logoname-black.svg"
cp "$ROOT/branding/wordmark.svg" "$CORE/img/logoname-white.svg"
cp "$ROOT/branding/mark.svg" "$CORE/img/logotransparent.png"

# Lottie files used as /lotties/${icon}.json — keep old names as copies
LOTTE="$CORE/frontend/public/lotties"
if [ -f "$LOTTE/infisical_loading.json" ]; then
  cp "$LOTTE/infisical_loading.json" "$LOTTE/vaultix_loading.json"
  cp "$LOTTE/infisical_loading_bw.json" "$LOTTE/vaultix_loading_bw.json"
  cp "$LOTTE/infisical_loading_white.json" "$LOTTE/vaultix_loading_white.json"
fi

export CORE
python3 - <<'PY'
import os, re, pathlib
core = pathlib.Path(os.environ["CORE"])
skip_bits = {"node_modules", ".git", "dist", "build", "frontend-build"}
text_ext = {
    ".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".md", ".yml", ".yaml",
    ".env", ".css", ".svg", ".txt", ".mjs", ".cjs", ".mdx",
}
roots = [
    core / "frontend" / "src",
    core / "frontend" / "index.html",
    core / "frontend" / "public" / "locales",
    core / "frontend" / "vite.config.ts",
    core / "backend" / "src",
    core / ".env.example",
    core / ".env.dev.example",
    core / "package.json",
]
# Ordered: longest / most specific first.
subs = [
    (re.compile(r"https://infisical\.com/_next/image\?url=%2Fimages%2Flogo-black\.png&w=64&q=75"),
     "${siteUrl}/images/logotransparent.svg"),
    (re.compile(r"https://infisical\.com/terms/cloud"), "https://shippin.ai/legal/terms"),
    (re.compile(r"https://infisical\.com/privacy"), "https://shippin.ai/legal/privacy"),
    (re.compile(r"https://infisical\.com/schedule-demo"), "https://shippin.ai"),
    (re.compile(r"https://infisical\.com/slack"), "https://shippin.ai"),
    (re.compile(r"https://upgrade\.infisical\.com/?"), "https://shippin.ai"),
    (re.compile(r"https://github\.com/Vaultix/infisical"), "https://shippin.ai"),
    (re.compile(r"https://github\.com/[Ii]nfisical/infisical"), "https://shippin.ai"),
    (re.compile(r"https://x\.com/infisical"), "https://shippin.ai"),
    (re.compile(r"https://www\.linkedin\.com/company/infisical/?"), "https://shippin.ai"),
    (re.compile(r"https://www\.youtube\.com/@infisical_os"), "https://shippin.ai"),
    (re.compile(r"https://us\.infisical\.com"), "https://vaultix.shippin.cloud"),
    (re.compile(r"https://eu\.infisical\.com"), "https://vaultix.shippin.cloud"),
    (re.compile(r"https://gamma\.infisical\.com"), "https://vaultix.shippin.cloud"),
    (re.compile(r"https://app\.infisical\.com"), "https://vaultix.shippin.cloud"),
    (re.compile(r"https://portal\.infisical\.com"), ""),
    (re.compile(r"https://infisical\.com/docs"), "https://vaultix.shippin.cloud/docs"),
    (re.compile(r"https://infisical\.com"), "https://vaultix.shippin.cloud"),
    (re.compile(r"http://infisical\.com"), "https://vaultix.shippin.cloud"),
    (re.compile(r"support@infisical\.com"), "support@shippin.ai"),
    (re.compile(r"dev@infisical\.local"), "vaultix@shippin.cloud"),
    (re.compile(r"@infisical\.com"), "@shippin.ai"),
    (re.compile(r"_infisical-verification"), "_vaultix-verification"),
    (re.compile(r"infisical_migrations"), "vaultix_migrations"),
    (re.compile(r"infisical_loading_white"), "vaultix_loading_white"),
    (re.compile(r"infisical_loading_bw"), "vaultix_loading_bw"),
    (re.compile(r"infisical_loading"), "vaultix_loading"),
    (re.compile(r"x-infisical-signature"), "x-vaultix-signature"),
    (re.compile(r"infisical-recovery-codes"), "vaultix-recovery-codes"),
    (re.compile(r"infisical:onboarding:"), "vaultix:onboarding:"),
    (re.compile(r"infisical\.lastLogin"), "vaultix.lastLogin"),
    (re.compile(r"infisical-cm-active-project-"), "vaultix-cm-active-project-"),
    (re.compile(r"infisical__hubspot-utk"), "vaultix__hubspot-utk"),
    (re.compile(r"infisical\.ico"), "favicon.svg"),
    (re.compile(r"Vaultix Inc\."), "AngryVibes LLC"),
    (re.compile(r"InfisicalProjectTemplate"), "VaultixProjectTemplate"),
    (re.compile(r"isInfisicalProjectTemplate"), "isVaultixProjectTemplate"),
    (re.compile(r"InfisicalSecretInput"), "VaultixSecretInput"),
    (re.compile(r"\bInfisical\b"), "Vaultix"),
    (re.compile(r"INFISICAL_"), "VAULTIX_"),
    (re.compile(r'"infisical"'), '"vaultix"'),
    (re.compile(r"'infisical'"), "'vaultix'"),
]

protect_res = [
    re.compile(r"@infisical/[A-Za-z0-9._/-]+"),
    re.compile(r"infisical_rdp_decoder"),
    re.compile(r"external-infisical"),
    re.compile(r"external_infisical"),
]

def walk(p: pathlib.Path):
    if p.is_file():
        yield p
        return
    if not p.exists():
        return
    for child in p.rglob("*"):
        if any(part in skip_bits for part in child.parts):
            continue
        if child.is_file() and child.suffix.lower() in text_ext:
            yield child

def stash_protected(raw: str):
    held = {}
    def stash(m):
        k = f"\x00KEEP{len(held)}\x00"
        held[k] = m.group()
        return k
    out = raw
    for p in protect_res:
        out = p.sub(stash, out)
    return out, held

changed = 0
for root in roots:
    for f in walk(root):
        try:
            raw = f.read_text(encoding="utf-8")
        except Exception:
            continue
        new, held = stash_protected(raw)
        for pat, rep in subs:
            new = pat.sub(rep, new)
        for k, v in held.items():
            new = new.replace(k, v)
        if new != raw:
            f.write_text(new, encoding="utf-8")
            changed += 1
print(f"rebranded {changed} files")
PY

# Title + icon (idempotent)
python3 - <<'PY'
from pathlib import Path
p = Path("frontend/index.html")
t = p.read_text()
t = t.replace("/infisical.ico", "/favicon.svg")
t = t.replace("<title>Infisical</title>", "<title>Vaultix</title>")
p.write_text(t)
print("index.html title Vaultix:", "<title>Vaultix</title>" in p.read_text())
PY

# Email logo must not load from leftover vendor CDN
python3 - <<'PY'
from pathlib import Path
p = Path("backend/src/services/smtp/emails/BaseEmailWrapper.tsx")
if p.exists():
    t = p.read_text()
    t = t.replace(
        'src="https://vaultix.shippin.cloud/_next/image?url=%2Fimages%2Flogo-black.png&w=64&q=75"',
        'src={`${siteUrl}/images/logotransparent.svg`}',
    )
    t = t.replace(
        'src="${siteUrl}/images/logotransparent.svg"',
        "src={`${siteUrl}/images/logotransparent.svg`}",
    )
    p.write_text(t)
    print("email logo:", "logotransparent.svg" in p.read_text())
PY

# License server default off (precise)
python3 - <<'PY'
from pathlib import Path
import re
p = Path("backend/src/lib/config/env.ts")
t = p.read_text()
t = t.replace('default("https://portal.infisical.com")', 'default("")')
t = t.replace('default("https://vaultix.shippin.cloud")  # license', t)  # no-op guard
t = re.sub(
    r'(LICENSE_SERVER_URL: zpStr\(z\.string\(\)\.optional\(\)\.)default\("[^"]*"\)',
    r'\1default("")',
    t,
)
t = re.sub(
    r'(LICENSE_SERVER_V2_MODE: z\.enum\(\["off", "read-compare", "on"\]\)\.)default\("[^"]+"\)',
    r'\1default("off")',
    t,
)
p.write_text(t)
print("env.ts license defaults patched")
PY

echo "remotes:" $(git remote)
echo "done"
