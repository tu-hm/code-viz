#!/usr/bin/env bash
# Runs inside a box:
#   box.sh build <program> <g++ args...>: the docker VM's load average, one timed g++ killed at 30 s, then the box's
#     memory.peak in MiB, OOM kills, file refaults and major faults
#   box.sh probe <program> <g++ args...>: g++ with -Winvalid-pch -H -time, untimed: which PCH main.cpp used, seconds per
#     subprocess, the same counters
#   box.sh compile <program> <name> <g++ args...>: g++ once; the binary goes to /bins/<program>.<name>
#   box.sh bench <program> <rounds> <names...>: each round runs every binary once on the program's input, in turn, with
#     the VM's load average; a binary that fails or times out leaves the rotation
set -u
mode=$1 program=$2
shift 2
cd /work
TIMEFORMAT='%R %U %S'

counters() {
	local peak oom stat
	peak=$(</sys/fs/cgroup/memory.peak)
	oom=$(awk '$1 == "oom_kill" { print $2 }' /sys/fs/cgroup/memory.events)
	stat=$(awk '{ v[$1] = $2 } END { printf "%s\t%s", v["workingset_refault_file"], v["pgmajfault"] }' /sys/fs/cgroup/memory.stat)
	printf '%.1f\t%s\t%s' "$(awk -v b="$peak" 'BEGIN { print b / 1048576 }')" "$oom" "$stat"
}

failure() {
	grep -m1 -E ': (fatal )?error|Killed' build.log | cut -c1-160
}

case $mode in
build)
	cp "/s7/programs/$program/main.cpp" .
	load=$(cut -d' ' -f1 /proc/loadavg)
	{ time timeout -k 2 30 g++ "$@" >build.log 2>&1; } 2>time.txt
	code=$?
	read -r wall user sys < <(tail -n 1 time.txt)
	printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$load" "$wall" "$user" "$sys" "$code" "$(counters)"
	;;
probe)
	cp "/s7/programs/$program/main.cpp" .
	g++ "$@" -Winvalid-pch -H -time >build.log 2>&1
	code=$?
	pch=$(awk '$1 == "!" && /\.gch$/ { n = split($2, p, "/"); print p[n] }' build.log)
	steps=$(awk '$1 == "#" { printf "%s %.2f+%.2f ", $2, $3, $4 }' build.log)
	printf '%s\t%s\t%s\t%s\t%s\n' "$code" "${pch:-none}" "$steps" "$(counters)" "$(failure)"
	;;
compile)
	name=$1
	shift
	cp "/s7/programs/$program/main.cpp" .
	if g++ "$@" >build.log 2>&1; then
		cp main "/bins/$program.$name"
	else
		printf '%s\tbuild\t%s\n' "$name" "$(failure)"
	fi
	;;
bench)
	rounds=$1
	shift
	cp "/in/$program.txt" input
	names=()
	for name in "$@"; do
		if [ -f "/bins/$program.$name" ]; then
			cp "/bins/$program.$name" "$name"
			names+=("$name")
		fi
	done
	for round in $(seq "$rounds"); do
		left=()
		for name in "${names[@]}"; do
			load=$(cut -d' ' -f1 /proc/loadavg)
			{ time timeout 60 "./$name" <input >out 2>err; } 2>time.txt
			code=$?
			read -r wall user sys < <(tail -n 1 time.txt)
			printf '%s\trun\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$load" "$wall" "$user" "$sys" "$code" \
				"$(md5sum <out | cut -c1-12)" "$(head -c 300 err | tr '\t\n' '  ')"
			rm -f ./*.gcda
			if [ "$code" -eq 0 ]; then left+=("$name"); fi
		done
		[ "${#left[@]}" -gt 0 ] || break
		names=("${left[@]}")
	done
	;;
esac
