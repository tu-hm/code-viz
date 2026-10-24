package domain

import "fmt"

const (
	// NewPrefix is where a completed trace's objects go, kept for Retention (§7.5).
	NewPrefix = "t7"
	// SharedPrefix is where sharing copies them, kept for SharedRetention (§8.6).
	SharedPrefix = "t90"
)

// ChunkKey is the object key of chunk i of a trace stored under prefix t7 or t90 (§7.5).
func ChunkKey(prefix, traceID string, i int) string {
	return fmt.Sprintf("%s/%s/chunk-%04d.json.gz", prefix, traceID, i)
}

// TailKey is the object key of a trace's output after the step limit (§19.9.5).
func TailKey(prefix, traceID string) string {
	return fmt.Sprintf("%s/%s/tail.txt.gz", prefix, traceID)
}

// TraceKeys are the object keys of a trace's chunks under prefix, then of its tail when it has one.
func TraceKeys(prefix, traceID string, chunks int, tail bool) []string {
	keys := make([]string, chunks, chunks+1)
	for i := range keys {
		keys[i] = ChunkKey(prefix, traceID, i)
	}
	if tail {
		keys = append(keys, TailKey(prefix, traceID))
	}
	return keys
}
