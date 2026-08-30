#!/bin/bash
# Dump the Vaultix Postgres. The encryption key is NOT in the dump.
# Lose VAULTIX_ENC_KEY and the dump is paper.
set -euo pipefail
DEST="${VAULTIX_BACKUP_DIR:-./backups}"
install -d -m 0700 "$DEST"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
: "${VAULTIX_DATABASE_URL:?VAULTIX_DATABASE_URL required}"
pg_dump "$VAULTIX_DATABASE_URL" | gzip -c > "$DEST/vaultix-${STAMP}.sql.gz"
chmod 600 "$DEST/vaultix-${STAMP}.sql.gz"
find "$DEST" -name 'vaultix-*.sql.gz' -mtime +14 -delete
echo "wrote $DEST/vaultix-${STAMP}.sql.gz"
