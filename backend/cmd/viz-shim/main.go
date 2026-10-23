package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"syscall"

	"github.com/tu-hm/code-viz/backend/internal/shim"
)

const usage = `usage: viz-shim             wait for SIGTERM (container main process)
       viz-shim -- cmd [args]  run cmd and write its fd 1, 2 and 3 as frames to stdout
`

func main() {
	if len(os.Args) == 1 {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
		<-sig
		return
	}
	if len(os.Args) < 3 || os.Args[1] != "--" {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if err := run(os.Args[2:]); err != nil {
		fmt.Fprintf(os.Stderr, "viz-shim: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	streams := []byte{shim.Stdout, shim.Stderr, shim.Wire}
	readers := make([]*os.File, len(streams))
	writers := make([]*os.File, len(streams))
	for i := range streams {
		r, w, err := os.Pipe()
		if err != nil {
			return fmt.Errorf("pipe: %w", err)
		}
		readers[i], writers[i] = r, w
	}

	cmd := exec.Command(args[0], args[1:]...) //nolint:gosec,noctx // runs what the adapter asked for, inside the sandbox, until it exits or the adapter kills the box
	cmd.Stdout = writers[0]
	cmd.Stderr = writers[1]
	cmd.ExtraFiles = writers[2:]
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", args[0], err)
	}
	for _, w := range writers {
		if err := w.Close(); err != nil {
			return fmt.Errorf("close pipe: %w", err)
		}
	}

	out := shim.NewWriter(os.Stdout)
	pumped := make(chan error, len(streams))
	for i, stream := range streams {
		go func() { pumped <- pump(out, stream, readers[i]) }()
	}

	var exitErr *exec.ExitError
	if err := cmd.Wait(); err != nil && !errors.As(err, &exitErr) {
		return fmt.Errorf("wait %s: %w", args[0], err)
	}
	// stragglers in the group would hold the pipes open
	if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); err != nil && !errors.Is(err, syscall.ESRCH) {
		return fmt.Errorf("kill process group: %w", err)
	}
	var err error
	for range streams {
		err = errors.Join(err, <-pumped)
	}
	if err != nil {
		return err
	}

	ws := cmd.ProcessState.Sys().(syscall.WaitStatus)
	if ws.Signaled() {
		return out.WriteExit(0, int(ws.Signal()))
	}
	return out.WriteExit(ws.ExitStatus(), 0)
}

func pump(out *shim.Writer, stream byte, r *os.File) error {
	buf := make([]byte, shim.MaxPayload)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			if werr := out.Write(stream, buf[:n]); werr != nil {
				return fmt.Errorf("write frame: %w", werr)
			}
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("read stream %d: %w", stream, err)
		}
	}
}
