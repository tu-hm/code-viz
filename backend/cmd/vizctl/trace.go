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
	"strings"
	"time"

	"github.com/tu-hm/code-viz/backend/internal/adapters/dockersandbox"
	"github.com/tu-hm/code-viz/backend/internal/app"
	"github.com/tu-hm/code-viz/backend/internal/domain"
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
)

func traceCommand(ctx context.Context, args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("trace", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	lang := fs.String("lang", "", "")
	optsFile := fs.String("options", "", "")
	if err := fs.Parse(args); err != nil || *lang == "" || fs.NArg() != 1 {
		return errors.New("usage: vizctl trace --lang <id> [--options <json file>] <source file> < stdin")
	}
	opts := trace.Options{MaxSteps: maxSteps, StartAtLines: []int{}}
	if *optsFile != "" {
		raw, err := os.ReadFile(*optsFile)
		if err != nil {
			return err
		}
		if err := json.Unmarshal(raw, &opts); err != nil {
			return fmt.Errorf("read options: %w", err)
		}
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

	res, err := record(ctx, m, src, in, opts)
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

func record(ctx context.Context, m domain.Manifest, src, stdin []byte, opts trace.Options) (res *tracecore.Result, err error) {
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
		b, kind, err := app.Build(ctx, box, m, opts)
		if err != nil {
			return nil, err
		}
		if !b.Ok {
			var raw string
			if b.Raw != nil {
				raw = strings.TrimRight(*b.Raw, "\n")
			}
			return nil, fmt.Errorf("%s:\n%s", kind, raw)
		}
	}

	rec := tracecore.NewRecorder(tracecore.Config{
		ID:       id,
		Source:   trace.Source{File: m.SourceFile, LineCount: lineCount(src)},
		Options:  opts,
		Limits:   tracecore.DefaultLimits,
		Validate: val.Wire,
	})
	traceCtx, cancelTrace := context.WithTimeout(ctx, wallTime)
	defer cancelTrace()
	exit, err := box.Run(traceCtx, ports.Command{
		Args:   m.TraceCmd,
		Env:    app.TraceEnv(m, opts),
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
