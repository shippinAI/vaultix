#!/usr/bin/env bash
set -euo pipefail

image="${1:-vaultix:smoke}"
provider="${2:-dragonfly}"
case "$provider" in dragonfly|redis) ;; *) echo "provider must be dragonfly or redis" >&2; exit 2 ;; esac
run="vaultix-smoke-${RANDOM}-$$"
envfile="$(mktemp)"
chmod 600 "$envfile"
cleanup() {
  docker rm -f "$run-engine" "$run-db" "$run-cache" >/dev/null 2>&1 || true
  docker network rm "$run" >/dev/null 2>&1 || true
  rm -f "$envfile"
}
trap cleanup EXIT

docker network create "$run" >/dev/null
docker run -d --name "$run-db" --network "$run" \
  -e POSTGRES_USER=vaultix -e POSTGRES_DB=vaultix -e POSTGRES_PASSWORD=vaultix-smoke-only \
  postgres:16.6-alpine >/dev/null
if [[ "$provider" == dragonfly ]]; then
  docker run -d --name "$run-cache" --network "$run" \
    docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2 \
    --default_lua_flags=allow-undeclared-keys --cache_mode=false --maxmemory=1gb --proactor_threads=2 >/dev/null
else
  docker run -d --name "$run-cache" --network "$run" redis:7.4-alpine \
    redis-server --maxmemory-policy noeviction >/dev/null
fi

ready=false
for _ in {1..60}; do
  if docker exec "$run-db" pg_isready -U vaultix -d vaultix >/dev/null 2>&1 && \
     docker exec "$run-cache" redis-cli ping >/dev/null 2>&1; then ready=true; break; fi
  sleep 2
done
if [[ "$ready" != true ]]; then echo "Database/cache did not become ready" >&2; exit 1; fi

cat > "$envfile" <<EOF
DB_CONNECTION_URI=postgres://vaultix:vaultix-smoke-only@$run-db:5432/vaultix
VAULTIX_CACHE_PROVIDER=$provider
VAULTIX_CACHE_URL=redis://$run-cache:6379
ENCRYPTION_KEY=$(openssl rand -hex 16)
AUTH_SECRET=$(openssl rand -hex 32)
SITE_URL=http://127.0.0.1:8200
TELEMETRY_ENABLED=false
DISABLE_UPDATE_CHECK=true
EOF

docker run -d --init --name "$run-engine" --network "$run" --env-file "$envfile" \
  -p 127.0.0.1::8080 "$image" >/dev/null
if ! port="$(docker port "$run-engine" 8080/tcp | head -1 | sed 's/.*://')"; then
  docker logs --tail 100 "$run-engine" >&2
  exit 1
fi
base="http://127.0.0.1:$port"
ready=false
for _ in {1..120}; do
  if curl --max-time 5 --connect-timeout 2 --fail --silent "$base/api/status" >/dev/null; then ready=true; break; fi
  sleep 2
done
if [[ "$ready" != true ]]; then
  echo "Vaultix image did not become healthy" >&2
  docker logs --tail 100 "$run-engine" >&2
  exit 1
fi
curl --fail --silent "$base/" | grep '<title>Vaultix</title>' >/dev/null
curl --fail --silent "$base/login" | grep '<title>Vaultix</title>' >/dev/null
curl --fail --silent --head "$base/api/status" | grep -i '^x-vaultix-product: Vaultix' >/dev/null
curl --fail --silent "$base/api/docs/json" | \
  node -e 'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>{const p=JSON.parse(s);if(p.info.title!=="Vaultix API"||p.servers[0].url!=="/"||!p.paths["/api/v1/vaultix/connections"]||!p.paths["/api/v1/vaultix/secret-references"])process.exit(1)})'
curl --fail --silent "$base/api/v1/vaultix/product" | \
  node -e 'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>{const p=JSON.parse(s);if(p.product!=="Vaultix"||p.featurePolicy!=="included"||p.ai.mode!=="guidance-and-authenticated-references"||p.cache.defaultProvider!=="dragonfly")process.exit(1)})'
curl --fail --silent "$base/api/v1/vaultix/mcp" -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  node -e 'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>{const t=JSON.parse(s).result.tools;if(!t.some(x=>x.name==="vaultix.catalog.get")||t.some(x=>x.name==="vaultix.secrets.references"))process.exit(1)})'
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "$base/api/v1/vaultix/projects")" == 401 ]]
MSYS_NO_PATHCONV=1 docker exec "$run-engine" test -f /backend/ai/clyffy/SKILL.md

docker exec -i "$run-engine" node <<'JS'
const { Queue, Worker, QueueEvents } = require("bullmq");
const Redis = require("ioredis");
const connection = new Redis(process.env.VAULTIX_CACHE_URL, { maxRetriesPerRequest: null });
const queue = new Queue("vaultix-smoke", { connection });
const events = new QueueEvents("vaultix-smoke", { connection });
const worker = new Worker("vaultix-smoke", async job => ({ checked: job.data.check }), { connection });
async function main() {
  try {
    await events.waitUntilReady();
    const job = await queue.add("probe", { check: "queue-lua" });
    const result = await job.waitUntilFinished(events, 15000);
    if (result.checked !== "queue-lua") throw new Error("Queue result mismatch");
    await queue.obliterate({ force: true });
  } finally {
    await worker.close();
    await events.close();
    await queue.close();
    await connection.quit();
  }
}
main().catch(() => { console.error("Vaultix queue smoke test failed"); process.exit(1); });
JS
docker restart "$run-engine" >/dev/null
# Docker Desktop can reassign an ephemeral published port when restarting.
port="$(docker port "$run-engine" 8080/tcp | head -1 | sed 's/.*://')"
base="http://127.0.0.1:$port"
ready=false
for _ in {1..60}; do
  if curl --max-time 5 --connect-timeout 2 --fail --silent "$base/api/status" >/dev/null; then ready=true; break; fi
  sleep 2
done
if [[ "$ready" != true ]]; then
  echo "Vaultix image failed to recover after restart" >&2
  docker logs --tail 100 "$run-engine" >&2
  exit 1
fi
echo "Vaultix image, MCP, $provider queue and engine restart smoke tests passed"
