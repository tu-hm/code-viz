package domain

import "errors"

// ErrInfra marks a failure of the infrastructure, not of the user's program. Only these are retried (§7.7).
var ErrInfra = errors.New("infrastructure error")
