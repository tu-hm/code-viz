package domain

import "errors"

// ErrInfra marks a failure of the infrastructure, not of the user's program. Only these are retried (§7.7).
var ErrInfra = errors.New("infrastructure error")

// ErrNoJob means no queued job is ready to claim.
var ErrNoJob = errors.New("no job to claim")

// ErrLeaseLost means the job no longer runs under the worker's lease. The worker stops it and writes nothing more (§7.13.2).
var ErrLeaseLost = errors.New("lease lost")
