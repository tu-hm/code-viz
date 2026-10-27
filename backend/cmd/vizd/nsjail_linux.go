//go:build linux

package main

import (
	"context"

	"github.com/tu-hm/code-viz/backend/internal/adapters/nsjail"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

const (
	nsjailCgroup = "/sys/fs/cgroup/viz" // made by scripts/nsjail-cgroups.sh, the worker image's entrypoint wrapper
	nsjailBoxes  = "/var/lib/viz/boxes"
	nsjailImages = "/opt/viz/rootfs" // runner image <tag> unpacked at /opt/viz/rootfs/<tag>
)

func openNsjail(ctx context.Context) (ports.Sandbox, error) {
	sb, err := nsjail.New(ctx, nsjailCgroup, nsjailBoxes, nsjailImages)
	if err != nil {
		return nil, err
	}
	return sb, nil
}
