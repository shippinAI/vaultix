#!/bin/bash
# Frozen. Vaultix does not fetch, clone, or connect to a snapshot host.
# Law: docs/0015-frozen-no-connection.md
echo "refused: no connection. the snapshot is frozen. there is no fetch." >&2
exit 2
