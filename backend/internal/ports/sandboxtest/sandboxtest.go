// Package sandboxtest is the conformance suite every ports.Sandbox adapter passes.
package sandboxtest

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/ports"
)

const memory = 128 << 20

type result struct {
	Exit   ports.Exit
	Stdout string
	Stderr string
	Wire   string
}

type step struct {
	args []string
	env  []string
	want result
}

// Run runs the suite against sb. image holds busybox and viz-shim at /opt/viz/viz-shim.
func Run(t *testing.T, sb ports.Sandbox, image string) {
	cases := []struct {
		name  string
		files map[string][]byte
		steps []step
	}{
		{
			name:  "exit code is reported",
			steps: []step{{args: sh("exit 3"), want: result{Exit: ports.Exit{Code: 3}}}},
		},
		{
			name:  "zero exit code is reported",
			steps: []step{{args: sh("true"), want: result{}}},
		},
		{
			name:  "kill signal is reported without a limit",
			steps: []step{{args: sh("kill -KILL $$"), want: result{Exit: ports.Exit{Signal: 9}}}},
		},
		{
			name:  "term signal is reported",
			steps: []step{{args: sh("kill -TERM $$"), want: result{Exit: ports.Exit{Signal: 15}}}},
		},
		{
			name: "fd 1, 2 and 3 arrive on their own writers",
			steps: []step{{
				args: sh(`printf '%s' "$GREETING"; printf 'err\n' >&2; printf '{"type":"hello"}\n' >&3`),
				env:  []string{"GREETING=out"},
				want: result{Stdout: "out", Stderr: "err\n", Wire: `{"type":"hello"}` + "\n"},
			}},
		},
		{
			name:  "stdin is empty",
			steps: []step{{args: sh("cat; printf done"), want: result{Stdout: "done"}}},
		},
		{
			name:  "files arrive in work",
			files: map[string][]byte{"main.py": []byte("print(1)\n"), "stdin": []byte("1 2\n")},
			steps: []step{{
				args: sh("pwd; cat main.py stdin; stat -c '%a' main.py stdin"),
				want: result{Stdout: "/work\nprint(1)\n1 2\n644\n644\n"},
			}},
		},
		{
			name: "binary built in one run executes in the next",
			steps: []step{
				{args: sh("cp /bin/busybox /work/echo"), want: result{}},
				{args: []string{"./echo", "traced"}, want: result{Stdout: "traced\n"}},
			},
		},
		{
			name:  "memory over the limit ends with memory limit",
			steps: []step{{args: sh("exec sort /dev/zero"), want: result{Exit: ports.Exit{Signal: 9, Limit: ports.LimitMemory}}}},
		},
		{
			name: "spawning under the pid limit works",
			steps: []step{{
				args: sh("i=0; while [ $i -lt 10 ]; do sleep 30 & i=$((i+1)); done; echo started"),
				want: result{Stdout: "started\n"},
			}},
		},
		{
			name: "fork bomb hits the pid limit and the box survives",
			steps: []step{
				{
					args: sh("i=0; while [ $i -lt 40 ]; do sleep 30 & i=$((i+1)); done; echo started"),
					want: result{Exit: ports.Exit{Code: 2}, Stderr: "sh: can't fork: Resource temporarily unavailable\n"},
				},
				{args: sh("echo alive"), want: result{Stdout: "alive\n"}},
			},
		},
		{
			name: "network is unreachable",
			steps: []step{{
				args: sh("wget -q -T 2 -O /dev/null http://1.1.1.1/ 2>/dev/null || echo tcp failed; nslookup example.com 1.1.1.1 >/dev/null 2>&1 || echo dns failed"),
				want: result{Stdout: "tcp failed\ndns failed\n"},
			}},
		},
		{
			name: "udp is unreachable",
			steps: []step{{
				args: sh("echo x | nc -u -w 1 1.1.1.1 53 2>/dev/null || echo udp failed"),
				want: result{Stdout: "udp failed\n"},
			}},
		},
		{
			name: "processes outside the box are out of reach",
			steps: []step{{
				args: sh(fmt.Sprintf("kill -0 %d 2>/dev/null && echo reachable || echo unreachable", os.Getpid())),
				want: result{Stdout: "unreachable\n"},
			}},
		},
		{
			name: "deep recursion ends with memory limit and the box survives",
			steps: []step{
				{args: sh("f() { f; }; f"), want: result{Exit: ports.Exit{Signal: 9, Limit: ports.LimitMemory}}},
				{args: sh("echo alive"), want: result{Stdout: "alive\n"}},
			},
		},
		{
			name: "new namespaces are refused",
			steps: []step{{
				args: sh("unshare -U true 2>/dev/null || echo refused"),
				want: result{Stdout: "refused\n"},
			}},
		},
		{
			name: "only work is writable",
			steps: []step{{
				args: sh(`for d in / /etc /tmp /opt/viz /work; do touch $d/probe 2>/dev/null && echo "$d writable" || echo "$d read-only"; done`),
				want: result{Stdout: "/ read-only\n/etc read-only\n/tmp read-only\n/opt/viz read-only\n/work writable\n"},
			}},
		},
		{
			name: "work holds 60 MB but not 70 MB",
			steps: []step{
				{args: sh("head -c 60000000 /dev/zero > /work/a && rm /work/a"), want: result{}},
				{args: sh("head -c 70000000 /dev/zero > /work/b 2>/dev/null || echo full"), want: result{Stdout: "full\n"}},
			},
		},
		{
			name: "runs as non-root without capabilities",
			steps: []step{{
				args: sh(`set -- $(grep ^Uid: /proc/self/status); [ "$2" != 0 ] && echo non-root; grep -E '^(CapEff|CapBnd|NoNewPrivs):' /proc/self/status`),
				want: result{Stdout: "non-root\nCapEff:\t0000000000000000\nCapBnd:\t0000000000000000\nNoNewPrivs:\t1\n"},
			}},
		},
		{
			name:  "stack limit is 256 MiB",
			steps: []step{{args: sh("ulimit -s"), want: result{Stdout: "262144\n"}}},
		},
		{
			name:  "aslr can be turned off",
			steps: []step{{args: []string{"setarch", "linux64", "-R", "cat", "/proc/self/personality"}, want: result{Stdout: "00040000\n"}}},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			box := start(t, sb, image, tc.files)
			for i, s := range tc.steps {
				got, err := run(t.Context(), box, s.args, s.env, nil)
				if err != nil {
					t.Fatalf("step %d: %v", i, err)
				}
				if diff := cmp.Diff(s.want, got); diff != "" {
					t.Fatalf("step %d (-want +got):\n%s", i, diff)
				}
			}
		})
	}

	t.Run("50 MB single-line output arrives intact", func(t *testing.T) {
		t.Parallel()
		box := start(t, sb, image, nil)
		got, err := run(t.Context(), box, sh(`head -c 50000000 /dev/zero | tr '\0' o; head -c 3000000 /dev/zero | tr '\0' w >&3`), nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		if got.Stdout != strings.Repeat("o", 50000000) {
			t.Errorf("stdout: %d bytes, want 50000000 bytes of o", len(got.Stdout))
		}
		if got.Wire != strings.Repeat("w", 3000000) {
			t.Errorf("wire: %d bytes, want 3000000 bytes of w", len(got.Wire))
		}
	})

	t.Run("deadline kills a busy loop and ends with time limit", func(t *testing.T) {
		t.Parallel()
		box := start(t, sb, image, nil)
		ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
		defer cancel()
		got, err := run(ctx, box, sh("true"), nil, nil)
		if err != nil || got.Exit != (ports.Exit{}) {
			t.Fatalf("before the deadline: exit %+v, err %v", got.Exit, err)
		}

		ctx, cancel = context.WithTimeout(t.Context(), time.Second)
		defer cancel()
		began := time.Now()
		got, err = run(ctx, box, sh("while :; do :; done"), nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		if diff := cmp.Diff(result{Exit: ports.Exit{Limit: ports.LimitTime}}, got); diff != "" {
			t.Errorf("(-want +got):\n%s", diff)
		}
		if took := time.Since(began); took > 10*time.Second {
			t.Errorf("run took %v after a 1 s deadline", took)
		}
		assertDead(t, box)
	})

	t.Run("cancel kills the box and returns the context error", func(t *testing.T) {
		t.Parallel()
		box := start(t, sb, image, nil)
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		_, err := run(ctx, box, sh("echo ready; sleep 60"), nil, writerFunc(func(p []byte) (int, error) {
			cancel()
			return len(p), nil
		}))
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("err = %v, want context.Canceled", err)
		}
		assertDead(t, box)
	})

	t.Run("writer error kills the box and is returned", func(t *testing.T) {
		t.Parallel()
		box := start(t, sb, image, nil)
		errFull := errors.New("output limit")
		_, err := run(t.Context(), box, []string{"yes"}, nil, writerFunc(func([]byte) (int, error) {
			return 0, errFull
		}))
		if !errors.Is(err, errFull) {
			t.Fatalf("err = %v, want %v", err, errFull)
		}
		assertDead(t, box)
	})
}

func start(t *testing.T, sb ports.Sandbox, image string, files map[string][]byte) ports.Box {
	t.Helper()
	box, err := sb.Start(t.Context(), ports.SandboxSpec{
		JobID:  "sandboxtest",
		Image:  image,
		Files:  files,
		Memory: memory,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := box.Close(context.WithoutCancel(t.Context())); err != nil {
			t.Error(err)
		}
	})
	return box
}

func run(ctx context.Context, box ports.Box, args, env []string, stdout writerFunc) (result, error) {
	var out, errOut, wire bytes.Buffer
	cmd := ports.Command{Args: args, Env: env, Stdout: &out, Stderr: &errOut, Wire: &wire}
	if stdout != nil {
		cmd.Stdout = stdout
	}
	exit, err := box.Run(ctx, cmd)
	return result{Exit: exit, Stdout: out.String(), Stderr: errOut.String(), Wire: wire.String()}, err
}

func assertDead(t *testing.T, box ports.Box) {
	t.Helper()
	if _, err := run(t.Context(), box, sh("true"), nil, nil); err == nil {
		t.Error("run after a kill succeeded, want an error")
	}
}

func sh(script string) []string {
	return []string{"sh", "-c", script}
}

type writerFunc func([]byte) (int, error)

func (f writerFunc) Write(p []byte) (int, error) {
	return f(p)
}
