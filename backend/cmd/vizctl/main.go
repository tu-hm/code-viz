package main

import (
	"fmt"
	"os"
)

const usage = `usage: vizctl <command> [args]

commands:
  trace     run a language adapter locally and print the trace
  validate  check a trace file against the trace schema
  diff      compare two traces
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}

	switch os.Args[1] {
	case "trace", "validate", "diff":
		fmt.Fprintf(os.Stderr, "vizctl %s: not implemented\n", os.Args[1])
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "vizctl: unknown command %q\n\n%s", os.Args[1], usage)
	os.Exit(2)
}
