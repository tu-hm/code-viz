package ports

import "context"

// Events wakes parked long-polls when a trace changes (§7.13.3).
type Events interface {
	// Wait returns nil once traceID's version is above since, ctx.Err() when ctx ends first, or domain.ErrCapacity when the pod already parks its most requests.
	Wait(ctx context.Context, traceID string, since int64) error
}
