#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/.."

missing=0

want_node=$(sed -n 's/.*"node": ">=\([0-9]*\)".*/\1/p' package.json)
want_pnpm=$(sed -n 's/.*"packageManager": "pnpm@\(.*\)".*/\1/p' package.json)

if [ "$(uname -s)" = Darwin ]; then
	mac=1
else
	mac=0
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

echo "$(uname -s) $(uname -m)"

node_hint="nvm install $want_node (https://github.com/nvm-sh/nvm), or https://nodejs.org/en/download"
if ! command -v node >/dev/null 2>&1; then
	need "node $want_node" "$node_hint"
else
	have=$(node --version)
	major=${have#v}
	major=${major%%.*}
	if [ "$major" -lt "$want_node" ]; then
		need "node $want_node or newer, found $have" "$node_hint"
	else
		ok "node $have"
	fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
	need "pnpm $want_pnpm" "$(pick 'corepack enable, or brew install pnpm' 'corepack enable')"
elif ! have=$(pnpm --version 2>&1); then
	need "a working pnpm: $have" "corepack enable, or pnpm self-update $want_pnpm"
elif [ "$have" != "$want_pnpm" ]; then
	need "pnpm $want_pnpm, found $have" "corepack enable, or pnpm self-update $want_pnpm"
else
	ok "pnpm $have"
fi

if command -v git >/dev/null 2>&1; then
	ok "git"
else
	need "git" "$(pick 'xcode-select --install' 'install git with your package manager')"
fi

if [ -d node_modules ]; then
	ok "dependencies installed"
else
	need "the workspace's dependencies" "pnpm install"
fi

if [ "$missing" = 1 ]; then
	echo
	echo "fix each need line above, then run this again"
	exit 1
fi

echo
echo "ready: pnpm dev"
