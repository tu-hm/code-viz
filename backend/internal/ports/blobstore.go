package ports

import "context"

// BlobStore holds trace chunks in object storage (§7.5).
type BlobStore interface {
	// Put stores gz, a gzipped JSON document, under key. It retries 3 times (§7.8); failures wrap domain.ErrInfra.
	Put(ctx context.Context, key string, gz []byte) error
}
