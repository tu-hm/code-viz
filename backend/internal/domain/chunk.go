package domain

import "fmt"

// ChunkKey is the object key of chunk i of a trace stored under prefix t7 or t90 (§7.5).
func ChunkKey(prefix, traceID string, i int) string {
	return fmt.Sprintf("%s/%s/chunk-%04d.json.gz", prefix, traceID, i)
}
