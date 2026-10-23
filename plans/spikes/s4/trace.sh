#!/usr/bin/env bash
# Runs inside viz-s4-gdb: trace.sh <program dir> <tracer.py> <out.ndjson>
# Builds with the §7.11.2 flags and keeps hello plus the first 1,001 steps; the tracer dies of SIGPIPE after that.
set -eu
dir=$1 tracer=$2 out=$3
work=$(mktemp -d)
cp "$dir/main.cpp" "$work/main.cpp"
cd "$work"
g++ -std=gnu++17 -O0 -g3 -fno-omit-frame-pointer main.cpp /opt/viz/flush_init.cpp -o main
stdin=/dev/null
if [ -f "$dir/stdin" ]; then stdin=$dir/stdin; fi
start=$(date +%s%N)
gdb -q -nx -batch -x "$tracer" --args ./main <"$stdin" 3>&1 >/dev/null 2>&1 | head -n 1002 >"$out" || true
end=$(date +%s%N)
echo "$(basename "$out"): $(wc -l <"$out") lines, $(wc -c <"$out") bytes, $(((end - start) / 1000000)) ms"
