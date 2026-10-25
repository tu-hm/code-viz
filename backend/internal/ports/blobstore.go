package ports

import (
	"context"
	"time"
)

// BlobStore holds trace chunks in object storage (§7.5).
type BlobStore interface {
	// Put stores gz, a gzipped document of contentType, under key. It retries 3 times (§7.8); failures wrap domain.ErrInfra.
	Put(ctx context.Context, key, contentType string, gz []byte) error
	// Sign returns a URL that GETs key from the public endpoint until ttl has passed (§8.4). It signs locally, without a request.
	Sign(ctx context.Context, key string, ttl time.Duration) (string, error)
	// Copy copies the object at from to the key to, server side, with its headers. Failures wrap domain.ErrInfra.
	Copy(ctx context.Context, from, to string) error
	// Delete removes keys; a key that is already gone is not an error. Failures wrap domain.ErrInfra.
	Delete(ctx context.Context, keys []string) error
}
