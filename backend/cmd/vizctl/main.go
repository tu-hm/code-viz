package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/tu-hm/code-viz/backend/schema"
)

const usage = `usage: vizctl <command> [args]

commands:
  trace     run a language adapter locally and print the trace
            vizctl trace --lang <id> <source file> < stdin
  validate  check a trace file against the trace schema
            vizctl validate <trace.json>
  diff      compare two traces
`

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := run(ctx, os.Args[1:], os.Stdin, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

func run(ctx context.Context, args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}

	var err error
	switch args[0] {
	case "trace":
		err = traceCommand(ctx, args[1:], stdin, stdout, stderr)
	case "validate":
		err = validateCommand(args[1:])
	case "diff":
		err = errors.New("not implemented")
	default:
		fmt.Fprintf(stderr, "vizctl: unknown command %q\n\n%s", args[0], usage)
		return 2
	}
	if err != nil {
		fmt.Fprintf(stderr, "vizctl %s: %v\n", args[0], err)
		return 1
	}
	return 0
}

func validateCommand(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: vizctl validate <trace.json>")
	}
	doc, err := os.ReadFile(args[0]) //nolint:gosec // the command reads the file its user names
	if err != nil {
		return err
	}
	val, err := schema.New()
	if err != nil {
		return err
	}
	if err := val.Trace(doc); err != nil {
		return fmt.Errorf("%s %w", args[0], err)
	}
	return nil
}
