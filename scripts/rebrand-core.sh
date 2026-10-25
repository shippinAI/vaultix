#!/bin/bash
# Rename vaultix MIT pin to Vaultix in customer chrome and operator-visible
# copy. Do not rename npm packages (@vaultix/...) or the RDP wasm import —
# those would break the build. Customer chrome must not say vaultix.
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
cp "$ROOT/branding/favicon.svg" "$CORE/frontend/public/vaultix.ico"
cp "$ROOT/branding/mark.svg" "$CORE/frontend/public/images/logotransparent.svg"
cp "$ROOT/branding/wordmark.svg" "$CORE/frontend/public/images/gradientLogo.svg"
cp "$ROOT/branding/wordmark.svg" "$CORE/frontend/public/images/biglogo.svg"
cp "$ROOT/branding/mark.svg" "$CORE/frontend/public/images/integrations/vaultix.png" 2>/dev/null || true
cp "$ROOT/branding/mark.svg" "$CORE/company/logo/dark.svg"
cp "$ROOT/branding/mark.svg" "$CORE/company/logo/light.svg"
cp "$ROOT/branding/wordmark.svg" "$CORE/img/logoname.svg"
cp "$ROOT/branding/wordmark.svg" "$CORE/img/logoname-black.svg"
cp "$ROOT/branding/wordmark.svg" "$CORE/img/logoname-white.svg"
cp "$ROOT/branding/mark.svg" "$CORE/img/logotransparent.png"

# Lottie files used as /lotties/${icon}.json — keep old names as copies
LOTTE="$CORE/frontend/public/lotties"
if [ -f "$LOTTE/vaultix_loading.json" ]; then
  cp "$LOTTE/vaultix_loading.json" "$LOTTE/vaultix_loading.json"
  cp "$LOTTE/vaultix_loading_bw.json" "$LOTTE/vaultix_loading_bw.json"
  cp "$LOTTE/vaultix_loading_white.json" "$LOTTE/vaultix_loading_white.json"
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
    (re.compile(r"https://vaultix\.com/_next/image\?url=%2Fimages%2Flogo-black\.png&w=64&q=75"),
     "${siteUrl}/images/logotransparent.svg"),
    (re.compile(r"https://vaultix\.com/terms/cloud"), "https://shippin.ai/legal/terms"),
    (re.compile(r"https://vaultix\.com/privacy"), "https://shippin.ai/legal/privacy"),
    (re.compile(r"https://vaultix\.com/schedule-demo"), "https://shippin.ai"),
    (re.compile(r"https://vaultix\.com/slack"), "https://shippin.ai"),
    (re.compile(r"https://upgrade\.vaultix\.com/?"), "https://shippin.ai"),
    (re.compile(r"https://github\.com/Vaultix/vaultix"), "https://shippin.ai"),
    (re.compile(r"https://github\.com/[Ii]nfisical/vaultix"), "https://shippin.ai"),
    (re.compile(r"https://x\.com/vaultix"), "https://shippin.ai"),
    (re.compile(r"https://www\.linkedin\.com/company/vaultix/?"), "https://shippin.ai"),
    (re.compile(r"https://www\.youtube\.com/@vaultix_os"), "https://shippin.ai"),
    (re.compile(r"https://us\.vaultix\.com"), "https://vaultix.shippin.cloud"),
    (re.compile(r"https://eu\.vaultix\.com"), "https://vaultix.shippin.cloud"),
    (re.compile(r"https://gamma\.vaultix\.com"), "https://vaultix.shippin.cloud"),
    (re.compile(r"https://app\.vaultix\.com"), "https://vaultix.shippin.cloud"),
    (re.compile(r"https://portal\.vaultix\.com"), ""),
    (re.compile(r"https://vaultix\.com/docs"), "https://vaultix.shippin.cloud/docs"),
    (re.compile(r"https://vaultix\.com"), "https://vaultix.shippin.cloud"),
    (re.compile(r"http://vaultix\.com"), "https://vaultix.shippin.cloud"),
    (re.compile(r"support@vaultix\.com"), "support@shippin.ai"),
    (re.compile(r"dev@vaultix\.local"), "vaultix@shippin.cloud"),
    (re.compile(r"@vaultix\.com"), "@shippin.ai"),
    (re.compile(r"_vaultix-verification"), "_vaultix-verification"),
    (re.compile(r"vaultix_migrations"), "vaultix_migrations"),
    (re.compile(r"vaultix_loading_white"), "vaultix_loading_white"),
    (re.compile(r"vaultix_loading_bw"), "vaultix_loading_bw"),
    (re.compile(r"vaultix_loading"), "vaultix_loading"),
    (re.compile(r"x-vaultix-signature"), "x-vaultix-signature"),
    (re.compile(r"vaultix-recovery-codes"), "vaultix-recovery-codes"),
    (re.compile(r"vaultix:onboarding:"), "vaultix:onboarding:"),
    (re.compile(r"vaultix\.lastLogin"), "vaultix.lastLogin"),
    (re.compile(r"vaultix-cm-active-project-"), "vaultix-cm-active-project-"),
    (re.compile(r"vaultix__hubspot-utk"), "vaultix__hubspot-utk"),
    (re.compile(r"vaultix\.ico"), "favicon.svg"),
    (re.compile(r"Vaultix Inc\."), "AngryVibes LLC"),
    (re.compile(r"vaultixProjectTemplate"), "VaultixProjectTemplate"),
    (re.compile(r"isvaultixProjectTemplate"), "isVaultixProjectTemplate"),
    (re.compile(r"vaultixSecretInput"), "VaultixSecretInput"),
    (re.compile(r"\bvaultix\b"), "Vaultix"),
    (re.compile(r"vaultix_"), "VAULTIX_"),
    (re.compile(r'"vaultix"'), '"vaultix"'),
    (re.compile(r"'vaultix'"), "'vaultix'"),
]

protect_res = [
    re.compile(r"@vaultix/[A-Za-z0-9._/-]+"),
    re.compile(r"vaultix_rdp_decoder"),
    re.compile(r"external-vaultix"),
    re.compile(r"external_vaultix"),
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
t = t.replace("/vaultix.ico", "/favicon.svg")
t = t.replace("<title>vaultix</title>", "<title>Vaultix</title>")
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
t = t.replace('default("https://portal.vaultix.com")', 'default("")')
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
