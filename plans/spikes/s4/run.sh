#!/usr/bin/env bash
# Traces the S4 programs with the GDB prototype and the variant tracer, then measures the sessions.
# usage: plans/spikes/s4/run.sh [dir for the wire sessions, 2.4 GB]
set -eu
out=${1:-$(mktemp -d)}
mkdir -p "$out"
out=$(cd "$out" && pwd)
cd "$(dirname "$0")"
backend=$(cd ../../../backend && pwd)
docker build --quiet --tag viz-s4-gdb:spike . >/dev/null

trace() {
	local program=$1 tracer=$2 name=$3
	shift 3
	docker run --rm "$@" -v "$backend/adapters/cpp":/opt/viz:ro -v "$PWD":/s4:ro -v "$out":/out \
		viz-s4-gdb:spike bash /s4/trace.sh "/s4/programs/$program" "$tracer" "/out/$name.ndjson"
}

for p in dfs-adj dfs-heap prefix; do
	trace "$p" /opt/viz/trace.py "$p.prototype"
	trace "$p" /s4/trace_variant.py "$p.dense1000" -e S4_ITEMS=1000
	trace "$p" /s4/trace_variant.py "$p.sparse" -e S4_ITEMS=1000 -e S4_SPARSE=1
done
for p in dfs-heap prefix; do
	trace "$p" /s4/trace_variant.py "$p.dense10000" -e S4_ITEMS=10000
done

# docker's default seccomp blocks personality(ADDR_NO_RANDOMIZE): addresses, and dfs-adj's uninitialized locals, differ per run
trace dfs-heap /s4/trace_variant.py dfs-heap.dense100 -e S4_ITEMS=100
cmp <(sed -E 's/0x[0-9a-f]+/0x/g' "$out/dfs-heap.prototype.ndjson") <(sed -E 's/0x[0-9a-f]+/0x/g' "$out/dfs-heap.dense100.ndjson")

echo "## §11 defaults"
go run . "$out"/*.prototype.ndjson "$out"/*.dense1000.ndjson "$out"/*.sparse.ndjson
go run . -items 10000 "$out"/*.dense10000.ndjson
echo "## size budget lifted, to see what 1,000 steps would cost"
go run . -trace-bytes $((1 << 30)) "$out"/*.dense1000.ndjson
go run . -items 10000 -trace-bytes $((1 << 30)) "$out"/*.dense10000.ndjson
