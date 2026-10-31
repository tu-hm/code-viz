#!/bin/sh
set -eu
root=/sys/fs/cgroup
mkdir -p "$root/init" "$root/viz"
# cgroup v2: a cgroup that hands controllers to its children can't hold processes
for pid in $(cat "$root/cgroup.procs"); do
	echo "$pid" >"$root/init/cgroup.procs" 2>/dev/null || true # pid already exited
done
echo "+cpu +memory +pids" >"$root/cgroup.subtree_control"
echo "+cpu +memory +pids" >"$root/viz/cgroup.subtree_control"
exec "$@"
