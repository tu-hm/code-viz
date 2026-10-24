#!/usr/bin/env bash
# HTTP load on one vizd --role=api: POST, GET of a completed trace, and 5,000 parked long-polls.
# Needs Docker and the Python runner image (make runner-images). The stack runs on ports 23306, 28333 and 18080.
# usage: plans/spikes/load/run.sh [seconds per phase] [dir for logs]
# VIZD=path runs that vizd binary instead of one built from backend/.
set -euo pipefail
secs=${1:-15}
out=${2:-$(mktemp -d)}
mkdir -p "$out"
here=$(cd "$(dirname "$0")" && pwd)
backend=$(cd "$here/../../../backend" && pwd)
compose=(docker compose -f "$here/compose.yaml")
trap 'kill $(jobs -p) 2>/dev/null || true; "${compose[@]}" down --volumes >/dev/null 2>&1' EXIT
echo "logs in $out"

vizd_bin=${VIZD:-$out/vizd}
[ -n "${VIZD:-}" ] || (cd "$backend" && go build -o "$vizd_bin" ./cmd/vizd)
(cd "$here/loadgen" && go build -o "$out/loadgen" .)
"${compose[@]}" up --detach --wait >/dev/null 2>&1
curl -sS -o /dev/null -X PUT http://127.0.0.1:28333/viz-traces

export MYSQL_DSN='viz:viz@tcp(127.0.0.1:23306)/viz' VIZ_ENV=dev VIZ_SANDBOX=docker VIZ_HTTP_ADDR=127.0.0.1:18080
export VIZ_ADAPTERS_DIR="$backend/adapters" S3_ENDPOINT=http://127.0.0.1:28333 S3_PUBLIC_ENDPOINT=http://127.0.0.1:28333
export S3_BUCKET=viz-traces S3_PATH_STYLE=true AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=viz AWS_SECRET_ACCESS_KEY=viz
export VIZ_IP_HASH_KEY=load-spike-ip-hash-key-not-a-secret VIZ_SLOTS=100000 VIZ_WEB_ORIGIN=http://localhost:5173
"$vizd_bin" migrate up >/dev/null 2>&1

api=http://127.0.0.1:18080/api/v1
sql() { "${compose[@]}" exec -T mysql mysql -uviz -pviz -N viz 2>/dev/null; }
start_vizd() {
	"$vizd_bin" --role="$1" >"$out/vizd-$1.log" 2>&1 &
	vizd=$!
	until curl -sf -o /dev/null http://127.0.0.1:18080/healthz; do sleep 0.2; done
}
cpu() { ps -o cputime= -p "$vizd" | awk -F'[:.]' '{print ($1*60+$2)*1000+$3*10}'; }
mysql_cpu() { "${compose[@]}" exec -T mysql awk '/usage_usec/{print int($2/1000)}' /sys/fs/cgroup/cpu.stat; }
counter() { echo "SHOW GLOBAL STATUS LIKE '$1'" | sql | cut -f2; }
cool_down() { until [ "$(netstat -an | grep -c TIME_WAIT)" -lt 1000 ]; do sleep 2; done; }
measure() {
	local name=$1
	shift
	cool_down
	local c0 m0 n0 e0 c1 m1 n1 e1
	c0=$(cpu) m0=$(mysql_cpu) n0=$(counter Connections) e0=$(counter Connection_errors_max_connections)
	"$@"
	c1=$(cpu) m1=$(mysql_cpu) n1=$(counter Connections) e1=$(counter Connection_errors_max_connections)
	echo "$name: vizd cpu $((c1 - c0)) ms, mysql cpu $((m1 - m0)) ms; mysql connections opened $((n1 - n0)), refused for max_connections $((e1 - e0)), most at once so far $(counter Max_used_connections)"
	echo "$name: vizd log errors: $(grep -c '"level":"ERROR"' "$out/vizd-api.log" || true); first: $(grep -m1 '"level":"ERROR"' "$out/vizd-api.log" | cut -c1-300 || true)"
}

echo "== seed: one completed 1,000-step Python trace through the Docker sandbox"
start_vizd all
src=$(python3 -c 'import json,sys;print(json.dumps(open(sys.argv[1]).read()))' "$backend/fixtures/python/long/main.py")
body="{\"language\":\"python3\",\"source\":$src,\"stdin\":\"\",\"options\":{\"maxSteps\":1000,\"startAtLines\":[]},\"context\":{\"problemCode\":null,\"client\":\"run.sh\"}}"
id=$(curl -sS -H 'Content-Type: application/json' -d "$body" "$api/visualizations" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
until [ "$(curl -sS "$api/visualizations/$id?wait=20&since=0" | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])')" = completed ]; do :; done
kill "$vizd"
wait "$vizd" || true

start_vizd api
echo "== POST /visualizations, 32 clients"
measure create "$out/loadgen" create -c 32 -d "${secs}s" -out "$out/created.txt"
echo "== GET /visualizations/{id} of a completed trace, 32 clients"
measure get "$out/loadgen" get -c 32 -d "${secs}s" -id "$id"

echo "== 5,000 long-polls parked on 500 queued traces, then one version bump for those traces"
head -500 "$out/created.txt" >"$out/parked.txt"
ids=$(sed "s/.*/'&'/" "$out/parked.txt" | paste -sd, -)
# distinct updated_at per row, as separate worker writes would give
echo "UPDATE traces t JOIN visualizations v ON v.trace_id = t.id SET t.version = t.version + 1,
  t.updated_at = NOW(6) + INTERVAL (CRC32(t.id) % 1000) MICROSECOND WHERE v.id IN ($ids);" >"$out/bump.sql"
measure park "$out/loadgen" park -n 5000 -ids "$out/parked.txt" \
	-trigger "${compose[*]} exec -T mysql mysql -uviz -pviz viz <$out/bump.sql 2>/dev/null" \
	-rss "ps -o rss= -p $vizd | awk '{print int(\$1/1024) \" MiB rss\"}'"
