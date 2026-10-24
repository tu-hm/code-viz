package domain

import "errors"

// ErrInfra marks a failure of the infrastructure, not of the user's program. Only these are retried (§7.7).
var ErrInfra = errors.New("infrastructure error")

// ErrNoJob means no queued job is ready to claim.
var ErrNoJob = errors.New("no job to claim")

// ErrLeaseLost means the job no longer runs under the worker's lease. The worker stops it and writes nothing more (§7.13.2).
var ErrLeaseLost = errors.New("lease lost")

// ErrInvalidRequest means the request body or its options are malformed (§8.2).
var ErrInvalidRequest = errors.New("invalid request")

// ErrPayloadTooLarge means the source or stdin is over its §11 limit.
var ErrPayloadTooLarge = errors.New("payload too large")

// ErrUnsupportedLanguage means the language is unknown, or visualize is disabled for it.
var ErrUnsupportedLanguage = errors.New("unsupported language")

// ErrQuotaExceeded means the caller used up its daily quota (D16).
var ErrQuotaExceeded = errors.New("daily quota exceeded")

// ErrCapacity means the service is too busy: the queue is above its cap, or the pod parks its most long-polls (§7.8).
var ErrCapacity = errors.New("over capacity")

// ErrNotFound means no visualization has the ID.
var ErrNotFound = errors.New("not found")

// ErrExpired means the visualization is past its retention (§11).
var ErrExpired = errors.New("expired")
