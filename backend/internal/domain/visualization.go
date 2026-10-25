package domain

import "time"

// TraceStatus is where a trace is in §7.7.
type TraceStatus string

const (
	TraceQueued    TraceStatus = "queued"
	TraceBuilding  TraceStatus = "building"
	TraceTracing   TraceStatus = "tracing"
	TraceCompleted TraceStatus = "completed"
	TraceFailed    TraceStatus = "failed"
	TraceCanceled  TraceStatus = "canceled"
)

// Final reports whether the trace has stopped changing.
func (s TraceStatus) Final() bool {
	return s == TraceCompleted || s == TraceFailed || s == TraceCanceled
}

const (
	// Retention is how long a new or reset trace is kept (D17).
	Retention = 7 * 24 * time.Hour
	// SharedRetention is how long a share link, its visualization and their trace are kept from the share on (D17).
	SharedRetention = 90 * 24 * time.Hour
	// IdempotencyWindow is how long a repeated Idempotency-Key returns the visualization the first request created (§8.2).
	IdempotencyWindow = 24 * time.Hour
	// MaxActive is how many visualizations a caller may have queued or running; a create past it detaches the oldest queued one (§11).
	MaxActive = 2
	// CapacityRetryAfter is how long a caller refused for capacity waits: "try again in a few seconds" (§5.6).
	CapacityRetryAfter = 5 * time.Second
)

// Rerun reports whether a create resets the trace and queues it again instead of attaching to it (§7.12):
// it was canceled, it failed for the infrastructure (failureKind internal_error or sandbox_error), or it expired.
// A trace that isn't final has a live job, so it is never reset.
func Rerun(status TraceStatus, failureKind string, expiresAt, now time.Time) bool {
	expired := now.After(expiresAt)
	switch status {
	case TraceCanceled:
		return true
	case TraceFailed:
		return failureKind == "internal_error" || failureKind == "sandbox_error" || expired
	case TraceCompleted:
		return expired
	}
	return false
}

// DailyQuota is how many visualizations a caller may create per UTC day.
func DailyQuota(signedIn bool) int {
	// anonymous 100/day, signed in 1,000 (D16)
	if signedIn {
		return 1000
	}
	return 100
}

// QuotaDay is the UTC day whose quota a request at now counts against.
func QuotaDay(now time.Time) time.Time {
	y, m, d := now.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// QuotaRetryAfter is the time from now to the next UTC midnight, when the daily quota resets (§11).
func QuotaRetryAfter(now time.Time) time.Duration {
	return QuotaDay(now).AddDate(0, 0, 1).Sub(now)
}
