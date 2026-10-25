package main

import (
	"fmt"
	"strings"

	"github.com/tu-hm/code-viz/backend/internal/adapters/manifest"
	"github.com/tu-hm/code-viz/backend/internal/domain"
)

const (
	adapterDir = "adapters"
	manifests  = adapterDir + "/*/manifest.yaml"
)

func findManifest(id string) (domain.Manifest, error) {
	set, err := manifest.Load(adapterDir)
	if err != nil {
		return domain.Manifest{}, err
	}
	if m, ok := set.Manifest(id); ok {
		return m, nil
	}
	var ids []string
	for _, m := range set.Manifests() {
		ids = append(ids, m.ID)
	}
	return domain.Manifest{}, fmt.Errorf("no manifest in %s has id %q (have: %s)", manifests, id, strings.Join(ids, ", "))
}
