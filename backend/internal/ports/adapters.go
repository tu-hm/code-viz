package ports

import "github.com/tu-hm/code-viz/backend/internal/domain"

// Adapters holds the language manifests (§10.2), loaded once at start.
type Adapters interface {
	// Manifest returns the manifest whose id is id, enabled or not.
	Manifest(id string) (domain.Manifest, bool)
	// Manifests returns every manifest, sorted by id.
	Manifests() []domain.Manifest
}
