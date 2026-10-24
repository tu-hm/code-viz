#!/usr/bin/env bash
# Spike S7: build time, build memory and run time of 10 CP solutions with and without the D21 safety checks.
# usage: plans/spikes/s7/run.sh [out dir]
#   S7_STEPS picks steps (default "probe build run run64"), S7_PROGRAMS programs (all 10),
#   S7_RUNS warm builds (5), S7_COLD_RUNS cold builds (3), S7_ROUNDS run rounds (7)
# Writes probe.tsv, build.tsv, run.tsv, run64.tsv and conditions.txt to the out dir, then prints summarize.py's tables.
set -eu
out=${1:-$(mktemp -d)}
mkdir -p "$out"
out=$(cd "$out" && pwd)
cd "$(dirname "$0")"
s7=$PWD
backend=$(cd ../../../backend && pwd)
steps=${S7_STEPS:-probe build run run64}
runs=${S7_RUNS:-5}
cold_runs=${S7_COLD_RUNS:-3}
rounds=${S7_ROUNDS:-7}

image=viz-runner-cpp:13.5-gdb14-1
spike=viz-s7-assert:spike
programs=(${S7_PROGRAMS:-tree-dp dijkstra bfs-grid knapsack segtree inversions repeat-hash kruskal tickets josephus})
# josephus-pch: josephus with <bits/stdc++.h> first, so it uses the PCH; built only
compiled=("${programs[@]}")
[ -n "${S7_PROGRAMS:-}" ] || compiled+=(josephus-pch)
small=(tree-dp:6000 dijkstra:1500 bfs-grid:250 segtree:2400 inversions:6000 repeat-hash:64000 kruskal:1500 tickets:3200)

# manifest.yaml on 24 Oct 2026: build.cmd and build.safetyFlags
base=(-std=gnu++17 -O0 -g3 -fno-omit-frame-pointer --coverage -Wall -Wextra -Wshadow -fdiagnostics-plain-output)
sources=(main.cpp /opt/viz/flush_init.cpp -o main)
unchecked=()
for f in "${base[@]}"; do
	[ "$f" = --coverage ] || unchecked+=("$f")
done
debug=(-D_GLIBCXX_DEBUG -fsanitize=undefined -fno-sanitize-recover=all)
assert=(-D_GLIBCXX_ASSERTIONS -fsanitize=undefined -fno-sanitize=null,alignment,pointer-overflow -fno-sanitize-recover=all)
ubsan=(-fsanitize=undefined -fno-sanitize-recover=all)
gcs=(none 32768/30 16384/10)

# dockersandbox.go: the dev sandbox's box, with the job's 256 MiB (worker.go)
box=(--user 65534:65534 --read-only --tmpfs /work:size=64m,exec,mode=1777 -w /work --init
	--cap-drop ALL --security-opt no-new-privileges --security-opt "seccomp=$backend/internal/adapters/dockersandbox/seccomp.json"
	--memory 256m --memory-swap 256m --cpus 1 --pids-limit 32 --ulimit stack=268435456:268435456 --network none
	--entrypoint bash -v "$s7":/s7:ro)

gcflags() {
	case $1 in
	none) ;;
	*) echo "--param ggc-min-heapsize=${1%/*} --param ggc-min-expand=${1#*/}" ;;
	esac
}

checkflags() {
	case $1 in
	off) ;;
	debug) echo "${debug[*]}" ;;
	assert) echo "${assert[*]}" ;;
	esac
}

imagefor() {
	if [ "$1" = assert ]; then echo "$spike"; else echo "$image"; fi
}

load() {
	uptime | sed -E 's/.*load averages?: *//; s/,//g' | cut -d' ' -f1
}

conditions() {
	{
		echo "## $1 $(date '+%F %T')"
		uptime
		docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
	} >>"$out/conditions.txt"
}

# pages of gcc, binutils and the precompiled headers: dropped from the page cache, or read into it by another container
evict() {
	docker run --rm --entrypoint bash "$spike" -c \
		'find /usr/local /usr/bin /usr/lib -xdev -type f -size +256k -exec dd if={} iflag=nocache count=0 status=none \;'
}
warm() {
	docker run --rm --entrypoint bash "$spike" -c \
		'find /usr/local /usr/bin /usr/lib -xdev -type f -size +256k -exec cat {} + >/dev/null'
}

# measure <image> <memory> <box.sh args...>: box.sh's line, then the sampler's, from outside the box's cgroup
measure() {
	local img=$1 memory=$2 cid sid res mem
	shift 2
	cid=$(docker create "${box[@]}" --memory "$memory" --memory-swap "$memory" "$img" /s7/box.sh "$@")
	sid=$(docker run -d --cgroupns=host -v /sys/fs/cgroup:/cg:ro -v "$out/sampler":/sampler:ro --entrypoint /sampler "$spike" "$cid")
	res=$(docker start -a "$cid")
	docker wait "$sid" >/dev/null
	mem=$(docker logs "$sid")
	docker rm -f "$cid" "$sid" >/dev/null
	printf '%s\t%s\n' "$res" "$mem"
}

build() {
	local cache=$1 rep=$2 checks=$3 p=$4 gc=$5
	# shellcheck disable=SC2046 # flags split on spaces
	printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$p" "$checks" "$gc" "$cache" "$rep" "$(load)" \
		"$(measure "$(imagefor "$checks")" 256m build "$p" "${base[@]}" $(checkflags "$checks") $(gcflags "$gc") "${sources[@]}")" \
		| tee -a "$out/build.tsv"
}

docker build --quiet --tag "$spike" . >/dev/null
case $(docker info --format '{{.Architecture}}') in
aarch64) arch=arm64 ;;
x86_64) arch=amd64 ;;
esac
GOOS=linux GOARCH=$arch CGO_ENABLED=0 go build -o "$out/sampler" sampler.go

mkdir -p "$out/inputs" "$out/inputs64"
for p in "${programs[@]}"; do
	[ -s "$out/inputs/$p.txt" ] || python3 -I "programs/$p/gen.py" >"$out/inputs/$p.txt"
done
for spec in "${small[@]}"; do
	p=${spec%:*}
	[ -s "$out/inputs64/$p.txt" ] || python3 -I "programs/$p/gen.py" "${spec#*:}" >"$out/inputs64/$p.txt"
done

for step in $steps; do
	conditions "$step start"
	case $step in
	probe)
		# 1 GiB: what each build needs when nothing stops it
		for p in "${compiled[@]}"; do
			for checks in off debug assert; do
				for gc in "${gcs[@]}"; do
					# shellcheck disable=SC2046
					printf '%s\t%s\t%s\t%s\n' "$p" "$checks" "$gc" \
						"$(measure "$(imagefor "$checks")" 1g probe "$p" "${base[@]}" $(checkflags "$checks") $(gcflags "$gc") "${sources[@]}")" \
						| tee -a "$out/probe.tsv"
				done
			done
		done
		;;
	build)
		rep=0
		while [ "$rep" -lt "$runs" ]; do
			rep=$((rep + 1))
			for checks in off debug assert; do
				warm
				for p in "${compiled[@]}"; do
					for gc in "${gcs[@]}"; do
						build warm "$rep" "$checks" "$p" "$gc"
					done
				done
			done
		done
		rep=0
		while [ "$rep" -lt "$cold_runs" ]; do
			rep=$((rep + 1))
			for p in "${compiled[@]}"; do
				for checks in off debug assert; do
					for gc in "${gcs[@]}"; do
						evict
						build cold "$rep" "$checks" "$p" "$gc"
					done
				done
			done
		done
		;;
	run | run64)
		in=inputs
		list=("${programs[@]}")
		builds=(A B C D E F G H)
		if [ "$step" = run64 ]; then
			in=inputs64
			list=("${small[@]%:*}")
			builds=(A D E)
		fi
		# gc params change no code (same objdump -d); with less GC the no-PCH checked builds die of OOM
		gc=$(gcflags 16384/10)
		# gcc picks a .gch by macros only: F would load checks-on.gch, built with UBSan, and crash gcc (ICE in
		# expand_UBSAN_NULL); G and H would load a .gch built with other sanitizers. The ABI macro's default skips them all
		nopch=-D_GLIBCXX_USE_CXX11_ABI=1
		bins=$out/bins-$step
		mkdir -p "$bins"
		chmod 777 "$bins"
		for p in "${list[@]}"; do
			for b in "${builds[@]}"; do
				img=$image
				case $b in
				A) flags="${base[*]} ${debug[*]} ${sources[*]}" ;;
				B) flags="${base[*]} ${sources[*]}" ;;
				C) flags="-std=gnu++17 -O2 main.cpp -o main" ;;
				D) flags="${unchecked[*]} ${sources[*]}" ;;
				E) flags="${base[*]} ${assert[*]} ${sources[*]}" img=$spike ;;
				F) flags="${base[*]} -D_GLIBCXX_DEBUG $nopch ${sources[*]}" ;;
				G) flags="${base[*]} ${ubsan[*]} $nopch ${sources[*]}" ;;
				H) flags="${base[*]} -D_GLIBCXX_ASSERTIONS ${ubsan[*]} $nopch ${sources[*]}" ;;
				esac
				# shellcheck disable=SC2086
				docker run --rm "${box[@]}" -v "$bins":/bins "$img" /s7/box.sh compile "$p" "$b" $gc $flags
			done |
				while IFS= read -r line; do printf '%s\t%s\t%s\n' "$p" "$(load)" "$line"; done | tee -a "$out/$step.tsv"
			# one box runs every build in turn, so a burst of host load lands on all of them
			docker run --rm "${box[@]}" -v "$out/$in":/in:ro -v "$bins":/bins:ro "$image" /s7/box.sh bench "$p" "$rounds" "${builds[@]}" |
				while IFS= read -r line; do printf '%s\t%s\t%s\n' "$p" "$(load)" "$line"; done | tee -a "$out/$step.tsv"
		done
		;;
	esac
	conditions "$step end"
done

python3 -I summarize.py "$out"
