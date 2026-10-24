#!/usr/bin/env bash
# Spike S6, short run: read and diff a 200,005-int array per step inside GDB, with the dev sandbox's box settings.
# usage: plans/spikes/s6/run.sh [e2e rounds, default 5]
set -eu
cd "$(dirname "$0")"
backend=$(cd ../../../backend && pwd)
docker run --rm --network none --read-only --tmpfs /work:size=64m,exec,mode=1777 --init --user 65534:65534 \
	--cap-drop ALL --security-opt no-new-privileges \
	--security-opt "seccomp=$backend/internal/adapters/dockersandbox/seccomp.json" \
	--cpus 1 --memory 256m --memory-swap 256m --pids-limit 32 --ulimit stack=268435456:268435456 \
	-v "$PWD":/s6:ro --entrypoint bash viz-runner-cpp:13.5-gdb14-1 /s6/box.sh "${1:-5}"
