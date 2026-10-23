package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/tu-hm/code-viz/backend/internal/adapters/dockersandbox"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/ports"
	"github.com/tu-hm/code-viz/backend/internal/tracecore"
	"github.com/tu-hm/code-viz/backend/schema"
)

// §11 defaults
const (
	maxSource = 64 << 10
	maxStdin  = 64 << 10
	maxSteps  = 1000
	wallTime  = 15 * time.Second
	memory    = 256 << 20
	maxDiag   = 64 << 10
)

func traceCommand(ctx context.Context, args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("trace", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	lang := fs.String("lang", "", "")
	if err := fs.Parse(args); err != nil || *lang == "" || fs.NArg() != 1 {
		return errors.New("usage: vizctl trace --lang <id> <source file> < stdin")
	}

	m, err := findManifest(*lang)
	if err != nil {
		return err
	}
	f, err := os.Open(fs.Arg(0))
	if err != nil {
		return err
	}
	defer f.Close()
	src, err := readAtMost(f, maxSource, "source")
	if err != nil {
		return err
	}
	in, err := readAtMost(stdin, maxStdin, "stdin")
	if err != nil {
		return err
	}

	res, err := record(ctx, m, src, in)
	if err != nil {
		return err
	}
	for _, l := range res.Logs {
		fmt.Fprintf(stderr, "adapter %s: %s\n", l.Level, l.Message)
	}
	return writeTrace(stdout, res.Trace())
}

func writeTrace(w io.Writer, tr trace.Trace) error {
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	return enc.Encode(tr)
}

func readAtMost(r io.Reader, limit int, name string) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(r, int64(limit)+1))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", name, err)
	}
	if len(b) > limit {
		return nil, fmt.Errorf("%s is over %d KiB", name, limit>>10)
	}
	return b, nil
}

func record(ctx context.Context, m domain.Manifest, src, stdin []byte) (res *tracecore.Result, err error) {
	val, err := schema.New()
	if err != nil {
		return nil, err
	}
	sb, err := dockersandbox.New(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { err = errors.Join(err, sb.Close()) }()

	id := newTraceID()
	box, err := sb.Start(ctx, ports.SandboxSpec{
		JobID:  id,
		Image:  m.Image,
		Files:  map[string][]byte{m.SourceFile: src, "stdin": stdin},
		Memory: memory,
	})
	if err != nil {
		return nil, fmt.Errorf("start sandbox: %w", err)
	}
	defer func() { err = errors.Join(err, box.Close(context.WithoutCancel(ctx))) }()

	if m.Build != nil {
		if err := runBuild(ctx, box, *m.Build, m.AllowedModules); err != nil {
			return nil, err
		}
	}

	rec := tracecore.NewRecorder(tracecore.Config{
		ID:       id,
		Source:   trace.Source{File: m.SourceFile, LineCount: lineCount(src)},
		Options:  trace.Options{MaxSteps: maxSteps, StartAtLines: []int{}},
		Limits:   tracecore.DefaultLimits,
		Validate: val.Wire,
	})
	traceCtx, cancelTrace := context.WithTimeout(ctx, wallTime)
	defer cancelTrace()
	exit, err := box.Run(traceCtx, ports.Command{
		Args:   m.TraceCmd,
		Env:    append([]string{"VIZ_MAX_STEPS=" + strconv.Itoa(maxSteps)}, m.TraceEnv...),
		Stdout: rec.Stdout(),
		Stderr: rec.Stderr(),
		Wire:   rec.Wire(),
	})
	res, err = rec.Finish(tracecore.Outcome{
		Code:        exit.Code,
		Signal:      exit.Signal,
		TimedOut:    exit.Limit == ports.LimitTime,
		OutOfMemory: exit.Limit == ports.LimitMemory,
	}, err)
	if err != nil {
		return nil, fmt.Errorf("trace: %w", err)
	}
	return res, nil
}

func runBuild(ctx context.Context, box ports.Box, b domain.Build, allowedModules []string) error {
	ctx, cancel := context.WithTimeout(ctx, b.Timeout)
	defer cancel()
	diag := &capped{max: maxDiag}
	exit, err := box.Run(ctx, ports.Command{
		Args:   b.Cmd,
		Env:    []string{"VIZ_MODULES_ALLOW=" + strings.Join(allowedModules, ",")},
		Stdout: diag,
		Stderr: diag,
		Wire:   io.Discard,
	})
	if err != nil {
		return fmt.Errorf("build: %w", err)
	}
	if exit.Limit == ports.LimitTime {
		return fmt.Errorf("%s: build timed out", api.FailureKindCompileError)
	}
	if exit != (ports.Exit{}) {
		kind := api.FailureKindCompileError
		if exit.Code != 0 && exit.Code == b.UnsupportedModuleExit {
			kind = api.FailureKindUnsupportedModule
		}
		return fmt.Errorf("%s:\n%s", kind, bytes.TrimRight(diag.buf, "\n"))
	}
	return nil
}

func newTraceID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return "trc_" + hex.EncodeToString(b)
}

func lineCount(src []byte) int {
	n := bytes.Count(src, []byte("\n"))
	if len(src) > 0 && src[len(src)-1] != '\n' {
		n++
	}
	return n
}

type capped struct {
	buf []byte
	max int
}

func (c *capped) Write(p []byte) (int, error) {
	room := max(c.max-len(c.buf), 0)
	c.buf = append(c.buf, p[:min(room, len(p))]...)
	return len(p), nil
}
