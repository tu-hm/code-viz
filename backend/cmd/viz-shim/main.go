//go:build linux

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"

	"golang.org/x/sys/unix"

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
	// threads count toward the box's 32 pids and a fork bomb can take the rest; one P keeps the shim to the threads it starts with
	runtime.GOMAXPROCS(1)
	var readers, writers [3]*os.File
	for i := range readers {
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
	// the program inherits 1000, so the oom killer takes it before the shim and the exit frame survives
	if err := setOOMScore("1000"); err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", args[0], err)
	}
	// lowering back to 0 needs no capability: 0 is the floor the shim started with
	if err := setOOMScore("0"); err != nil {
		return err
	}
	for _, w := range writers {
		if err := w.Close(); err != nil {
			return fmt.Errorf("close pipe: %w", err)
		}
	}

	out := shim.NewWriter(os.Stdout)
	forwarded := make(chan error, 1)
	go func() { forwarded <- forward(out, readers) }()

	var exitErr *exec.ExitError
	if err := cmd.Wait(); err != nil && !errors.As(err, &exitErr) {
		return fmt.Errorf("wait %s: %w", args[0], err)
	}
	// stragglers in the group would hold the pipes open
	if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); err != nil && !errors.Is(err, syscall.ESRCH) {
		return fmt.Errorf("kill process group: %w", err)
	}
	if err := <-forwarded; err != nil {
		return err
	}

	ws := cmd.ProcessState.Sys().(syscall.WaitStatus)
	if ws.Signaled() {
		return out.WriteExit(0, int(ws.Signal()))
	}
	return out.WriteExit(ws.ExitStatus(), 0)
}

func setOOMScore(adj string) error {
	if err := os.WriteFile("/proc/self/oom_score_adj", []byte(adj), 0); err != nil {
		return fmt.Errorf("set oom score: %w", err)
	}
	return nil
}

func forward(out *shim.Writer, pipes [3]*os.File) error {
	defer runtime.KeepAlive(pipes) // a collected os.File closes its fd; the loop holds only the numbers
	var fds [3]unix.PollFd
	for i, p := range pipes {
		fd := int(p.Fd()) // Fd switches the pipe to blocking reads
		if err := unix.SetNonblock(fd, true); err != nil {
			return fmt.Errorf("set nonblock: %w", err)
		}
		fds[i] = unix.PollFd{Fd: int32(fd), Events: unix.POLLIN} //nolint:gosec // fds stay below RLIMIT_NOFILE, far under 2^31
	}
	stdout, stderr, wire := &fds[0], &fds[1], &fds[2]
	buf := make([]byte, shim.MaxPayload)

	for stdout.Fd >= 0 || stderr.Fd >= 0 || wire.Fd >= 0 {
		_, err := unix.Poll(fds[:], -1)
		if errors.Is(err, unix.EINTR) {
			continue
		}
		if err != nil {
			return fmt.Errorf("poll: %w", err)
		}
		// count fd 3, then drain fd 1/2 => output written before those bytes is waiting already; a tracer that holds the program until fd 3 empties lets none in after them (§10.1)
		unread := 0
		if wire.Fd >= 0 {
			unread, err = unix.IoctlGetInt(int(wire.Fd), unix.TIOCINQ) // linux's name for FIONREAD
			if err != nil {
				return fmt.Errorf("count stream %d: %w", shim.Wire, err)
			}
		}
		if err := drain(out, shim.Stdout, stdout, buf); err != nil {
			return err
		}
		if err := drain(out, shim.Stderr, stderr, buf); err != nil {
			return err
		}
		if unread == 0 && wire.Revents&unix.POLLHUP != 0 {
			wire.Fd = -1
		}
		for unread > 0 {
			n, err := read(wire, buf[:min(unread, len(buf))])
			if err != nil {
				return fmt.Errorf("read stream %d: %w", shim.Wire, err)
			}
			if err := send(out, shim.Wire, buf[:n]); err != nil {
				return err
			}
			unread -= n
		}
	}
	return nil
}

func drain(out *shim.Writer, stream byte, p *unix.PollFd, buf []byte) error {
	for p.Fd >= 0 {
		n, err := read(p, buf)
		if err != nil {
			return fmt.Errorf("read stream %d: %w", stream, err)
		}
		if n == 0 {
			return nil
		}
		if err := send(out, stream, buf[:n]); err != nil {
			return err
		}
	}
	return nil
}

func read(p *unix.PollFd, buf []byte) (int, error) {
	n, err := unix.Read(int(p.Fd), buf)
	if errors.Is(err, unix.EAGAIN) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if n == 0 {
		p.Fd = -1
	}
	return n, nil
}

func send(out *shim.Writer, stream byte, p []byte) error {
	if len(p) == 0 {
		return nil
	}
	if err := out.Write(stream, p); err != nil {
		return fmt.Errorf("write frame: %w", err)
	}
	return nil
}
