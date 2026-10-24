#!/usr/bin/env bash
# Runs inside the runner image: box.sh <rounds>
set -eu
cd /work
cp /s6/programs/dfs/main.cpp .
g++ -std=gnu++17 -O0 -g3 -fno-omit-frame-pointer --coverage -Wall -Wextra -Wshadow -fdiagnostics-plain-output \
	--param ggc-min-heapsize=32768 --param ggc-min-expand=30 main.cpp /opt/viz/flush_init.cpp -o main
gdb -q -nx -batch -x /s6/bench.py --args ./main 2>&1 | grep -E '^(array|live|synthetic)'
for round in $(seq "$1"); do
	for tracer in /opt/viz/trace.py /s6/trace_s6.py; do
		start=$(date +%s%N)
		gdb -q -nx -batch -x "$tracer" --args ./main 3>out.ndjson >/dev/null 2>err.txt </dev/null
		end=$(date +%s%N)
		echo "e2e round $round $(basename "$tracer"): $(($(wc -l <out.ndjson) - 2)) steps, $(((end - start) / 1000000)) ms $(cat s6.txt 2>/dev/null || true)"
		rm -f s6.txt
	done
done
