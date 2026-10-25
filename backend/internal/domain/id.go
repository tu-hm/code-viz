package domain

import (
	"encoding/hex"
	"fmt"
	"io"
)

// NewVisualizationID returns a viz_ ID of 128 bits read from r, crypto/rand.Reader in production (§7.12).
func NewVisualizationID(r io.Reader) (string, error) {
	return newID("viz_", r)
}

// NewTraceID returns a trc_ ID of 128 bits read from r, crypto/rand.Reader in production (§7.12).
func NewTraceID(r io.Reader) (string, error) {
	return newID("trc_", r)
}

func newID(prefix string, r io.Reader) (string, error) {
	b := make([]byte, 16)
	if _, err := io.ReadFull(r, b); err != nil {
		return "", fmt.Errorf("read %s id: %w", prefix, err)
	}
	return prefix + hex.EncodeToString(b), nil
}
