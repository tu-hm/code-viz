#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/.."

missing=0

if [ "$(uname -s)" = Darwin ]; then
	mac=1
else
	mac=0
fi

if command -v apt-get >/dev/null 2>&1; then
	pkg="sudo apt-get install -y"
elif command -v dnf >/dev/null 2>&1; then
	pkg="sudo dnf install -y"
else
	pkg="install with your package manager:"
fi

pick() {
	if [ "$mac" = 1 ]; then
		echo "$1"
	else
		echo "$2"
	fi
}

ok() {
	echo "ok    $1"
}

need() {
	echo "need  $1"
	echo "      $2"
	missing=1
}

want() {
	echo "want  $1"
	echo "      $2"
}

echo "$(uname -s) $(uname -m)"

if ! command -v go >/dev/null 2>&1; then
	need "go" "$(pick 'brew install go' 'install from https://go.dev/dl (distro packages lag behind)')"
elif ! out=$(go list -m 2>&1); then
	need "a Go toolchain that satisfies go.mod: $out" "go env -w GOTOOLCHAIN=auto, or install the version go.mod names from https://go.dev/dl"
else
	ok "$(go version)"
fi

for tool in make git; do
	if command -v "$tool" >/dev/null 2>&1; then
		ok "$tool"
	else
		need "$tool" "$(pick 'xcode-select --install' "$pkg $tool")"
	fi
done

if ! command -v docker >/dev/null 2>&1; then
	need "docker" "$(pick 'install OrbStack (brew install --cask orbstack) or Docker Desktop' 'install Docker Engine: https://docs.docker.com/engine/install/')"
elif ! out=$(docker info 2>&1 >/dev/null); then
	case "$out" in
	*"permission denied"*)
		need "access to the Docker socket" "sudo usermod -aG docker \$USER, then log out and back in"
		;;
	*)
		need "a running Docker daemon" "$(pick 'start OrbStack or Docker Desktop' 'sudo systemctl start docker')"
		;;
	esac
else
	ok "docker $(docker version --format '{{.Server.Version}} ({{.Server.Os}}/{{.Server.Arch}})')"
fi

if out=$(docker compose version --short 2>/dev/null); then
	ok "docker compose $out"
else
	need "docker compose v2" "$(pick 'ships with OrbStack and Docker Desktop' "$pkg docker-compose-plugin")"
fi

if command -v cc >/dev/null 2>&1; then
	ok "C compiler, for go test -race"
else
	want "a C compiler, for go test -race" "$(pick 'xcode-select --install' "$pkg gcc")"
fi

if [ "$missing" = 1 ]; then
	echo
	echo "install what is missing, then run this again"
	exit 1
fi

echo
echo "ready: make test"
