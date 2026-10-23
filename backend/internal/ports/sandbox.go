package ports

import (
	"context"
	"io"
)

// Sandbox starts one fresh Box per job (§12).
type Sandbox interface {
	// Start creates a box with spec.Files in /work. Infrastructure failures wrap domain.ErrInfra.
	Start(ctx context.Context, spec SandboxSpec) (Box, error)
}

type SandboxSpec struct {
	JobID  string
	Image  string
	Files  map[string][]byte
	Memory int64 // bytes; memory + swap
}

// Box runs one job's commands one after another over a shared /work, so a build's output is still there for the trace.
type Box interface {
	// Run runs cmd with stdin on /dev/null. Writes to cmd's writers come from one goroutine, in the order the sandbox read them.
	// When ctx's deadline passes, Run kills the box and returns Exit{Limit: LimitTime} with a nil error. When ctx is canceled, it kills the box and returns ctx.Err().
	// When a writer returns an error, Run kills the box and returns that error wrapped. The core enforces its output, step and size limits this way.
	// After a kill the box is dead, and every later Run returns an error.
	Run(ctx context.Context, cmd Command) (Exit, error)
	// Close destroys the box and its /work.
	Close(ctx context.Context) error
}

type Command struct {
	Args   []string
	Env    []string
	Stdout io.Writer
	Stderr io.Writer
	Wire   io.Writer // fd 3
}

type Limit string

const (
	LimitTime   Limit = "time"
	LimitMemory Limit = "memory"
)

type Exit struct {
	Code   int
	Signal int   // non-zero when a signal ended the program
	Limit  Limit // set when a sandbox limit ended the program
}
