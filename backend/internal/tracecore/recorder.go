// Package tracecore turns a tracer's wire stream (§10.1) into a stored trace (§9): stable ids, keyframes and deltas, the §11 limits, and chunks.
package tracecore

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync/atomic"

	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/gen/wire"
)

// ErrMalformed marks tracer output that breaks the wire protocol. The job fails with internal_error (§7.8).
var ErrMalformed = errors.New("malformed tracer output")

var (
	errSizeLimit   = errors.New("trace size limit")
	errOutputLimit = errors.New("output limit")
)

// Limits are the §11 limits the core enforces outside the sandbox. The step limit is Options.MaxSteps.
type Limits struct {
	TraceBytes  int // uncompressed steps
	OutputBytes int // stdout and stderr together
	HeapObjects int // per step
	Frames      int // innermost frames kept besides the global frame
	StringChars int
	Items       int // per container
	Cells       int // non-default cells per sparse sequence; more => window only (§19.9.1)
	StepCells   int // non-default cells across one step message's sparse sequences
}

// DefaultLimits are the §11 defaults (D16).
var DefaultLimits = Limits{
	TraceBytes:  20 << 20,
	OutputBytes: 64 << 10,
	HeapObjects: 500,
	Frames:      100,
	StringChars: 1000,
	Items:       1000,
	Cells:       10_000,
	StepCells:   100_000,
}

const maxLogBytes = 64 << 10 // adapter log messages kept per run

type Config struct {
	ID      string
	Source  trace.Source
	Options trace.Options
	Limits  Limits
	// Validate checks one fd-3 line against wire.v1.schema.json. Its error must not quote the line (§7.8).
	Validate func(line []byte) error
}

// Recorder builds one run's trace from the streams Box.Run writes. It is not safe for concurrent use; Box.Run calls its writers from one goroutine.
type Recorder struct {
	cfg Config

	partial []byte // fd-3 bytes after the last newline
	lineNo  int
	hello   *wire.Hello
	exit    *wire.Exit
	logs    []wire.Log
	logSize int

	frameIDs  map[string]string // wire frame id => fN
	objectIDs map[string]string // native object id => oN
	seqs      map[string]*seq   // native object id => sparse sequence in the last step message
	prev      snapshotJSON
	steps     []trace.Step
	stepCount atomic.Int64 // len(steps), for StepCount on other goroutines
	size      int

	stdout, stderr []byte // output since the last recorded step
	outputBytes    int
	tail           []byte // output after the step limit
	tailStdout     int

	truncation *trace.SummaryTruncation
	stop       error // once set, every write returns it and the sandbox kills the box
}

func NewRecorder(cfg Config) *Recorder {
	return &Recorder{
		cfg:       cfg,
		frameIDs:  map[string]string{},
		objectIDs: map[string]string{},
		steps:     []trace.Step{},
	}
}

// Stdout takes the program's fd 1.
func (r *Recorder) Stdout() io.Writer { return writer{r, 1} }

// Stderr takes the program's fd 2.
func (r *Recorder) Stderr() io.Writer { return writer{r, 2} }

// Wire takes the tracer's fd 3 (NDJSON).
func (r *Recorder) Wire() io.Writer { return writer{r, 3} }

// StepCount returns how many steps are recorded so far. Unlike the rest of Recorder, it is safe to call while Box.Run writes.
func (r *Recorder) StepCount() int { return int(r.stepCount.Load()) }

type writer struct {
	r  *Recorder
	fd int
}

func (w writer) Write(p []byte) (int, error) {
	r := w.r
	if r.stop != nil {
		return 0, r.stop
	}
	var err error
	switch w.fd {
	case 1:
		err = r.output(wire.OutStreamStdout, p)
	case 2:
		err = r.output(wire.OutStreamStderr, p)
	case 3:
		err = r.wire(p)
	}
	if err != nil {
		r.stop = err
		return 0, err
	}
	return len(p), nil
}

func (r *Recorder) wire(p []byte) error {
	maxLine := r.cfg.Limits.TraceBytes // a step bigger than the whole trace budget can't be recorded
	for len(p) > 0 {
		i := bytes.IndexByte(p, '\n')
		if i < 0 {
			if len(r.partial)+len(p) > maxLine {
				r.truncate(trace.SummaryTruncationReasonSizeLimit)
				return errSizeLimit
			}
			r.partial = append(r.partial, p...)
			return nil
		}
		if len(r.partial)+i > maxLine {
			r.truncate(trace.SummaryTruncationReasonSizeLimit)
			return errSizeLimit
		}
		r.partial = append(r.partial, p[:i]...)
		p = p[i+1:]
		if err := r.message(r.partial); err != nil {
			return err
		}
		r.partial = r.partial[:0]
	}
	return nil
}

func (r *Recorder) message(line []byte) error {
	r.lineNo++
	if err := r.cfg.Validate(line); err != nil {
		return r.malformed("%d bytes: %v", len(line), err)
	}
	var head wire.Message
	if err := json.Unmarshal(line, &head); err != nil {
		return r.malformed("message does not decode")
	}

	switch {
	case head.Type == wire.MessageTypeLog:
		var msg wire.Log
		if err := json.Unmarshal(line, &msg); err != nil {
			return r.malformed("log does not decode")
		}
		if r.logSize+len(msg.Message) <= maxLogBytes {
			r.logSize += len(msg.Message)
			r.logs = append(r.logs, msg)
		}
		return nil
	case r.exit != nil:
		return r.malformed("%s after exit", head.Type)
	case head.Type == wire.MessageTypeHello && r.hello != nil:
		return r.malformed("second hello")
	case head.Type != wire.MessageTypeHello && r.hello == nil:
		return r.malformed("%s before hello", head.Type)
	}

	switch head.Type {
	case wire.MessageTypeHello:
		r.hello = &wire.Hello{}
		if err := json.Unmarshal(line, r.hello); err != nil {
			return r.malformed("hello does not decode")
		}
	case wire.MessageTypeStep:
		var s wire.Step
		if err := json.Unmarshal(line, &s); err != nil {
			return r.malformed("step does not decode")
		}
		return r.step(s)
	case wire.MessageTypeOut:
		var o wire.Out
		if err := json.Unmarshal(line, &o); err != nil {
			return r.malformed("out does not decode")
		}
		return r.output(o.Stream, []byte(o.Data))
	case wire.MessageTypeExit:
		r.exit = &wire.Exit{}
		if err := json.Unmarshal(line, r.exit); err != nil {
			return r.malformed("exit does not decode")
		}
		if r.exit.LineHits != nil && r.exit.LineHitsSource == nil {
			return r.malformed("exit with lineHits but no lineHitsSource")
		}
	}
	return nil
}

func (r *Recorder) malformed(format string, args ...any) error {
	return fmt.Errorf("%w: fd 3 line %d: %s", ErrMalformed, r.lineNo, fmt.Sprintf(format, args...))
}

func (r *Recorder) output(stream wire.OutStream, p []byte) error {
	room := r.cfg.Limits.OutputBytes - r.outputBytes
	over := len(p) > room
	if over {
		p = p[:room]
	}
	r.outputBytes += len(p)

	switch {
	case r.truncation != nil:
		r.tail = append(r.tail, p...)
		if stream == wire.OutStreamStdout {
			r.tailStdout += len(p)
		}
	case stream == wire.OutStreamStdout:
		r.stdout = append(r.stdout, p...)
	default:
		r.stderr = append(r.stderr, p...)
	}
	if over {
		return errOutputLimit
	}
	return nil
}

// truncate records why the trace stops. The first limit wins: a time limit during the untraced tail keeps step_limit.
func (r *Recorder) truncate(reason trace.SummaryTruncationReason) {
	if r.truncation != nil {
		return
	}
	var at *int
	if n := len(r.steps); n > 0 {
		line := r.steps[n-1].Line
		at = &line
	}
	r.truncation = &trace.SummaryTruncation{Reason: reason, AtLine: at}
}
