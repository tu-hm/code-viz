#!/bin/sh
set -eu
cd "$(dirname "$0")"
image=python:3.12.15-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704
docker run --rm -v "$PWD":/s2:ro "$image" python /s2/probes.py
docker run --rm -v "$PWD":/s2:ro "$image" python /s2/compare.py
docker run --rm -v "$PWD":/s2:ro "$image" python /s2/bench.py "${1:-9}"
