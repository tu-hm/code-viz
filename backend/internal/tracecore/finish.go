package tracecore

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"

	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/gen/wire"
)

const (
	version    = "1.2" // trace format v1.2 (D24): error kinds and values (§19.6)
	chunkSteps = 250   // D2; a multiple of keyframeInterval, so every chunk starts on a keyframe
)

// Outcome mirrors ports.Exit: how Box.Run ended.
type Outcome struct {
	Code        int
	Signal      int // Linux signal number; 0 when no signal ended the program
	TimedOut    bool
	OutOfMemory bool
}

// Result is a finished trace.
type Result struct {
	Header Header
	Steps  []trace.Step
	Tail   []byte     // output after the step limit, stored as tail.txt.gz (§19.9.5); nil otherwise
	Logs   []wire.Log // adapter log messages: internal logs only, never shown to users
}

// Header is the trace document without steps (§9.1), as stored in traces.header.
type Header struct {
	Version  string         `json:"version"`
	ID       string         `json:"id"`
	Language trace.Language `json:"language"`
	Source   trace.Source   `json:"source"`
	Options  trace.Options  `json:"options"`
	Summary  trace.Summary  `json:"summary"`
	Encoding trace.Encoding `json:"encoding"`
}

// Chunk is one stored object of steps (§7.5).
type Chunk struct {
	Index    int
	FromStep int
	ToStep   int    // inclusive
	Gzip     []byte // a JSON array of steps; its length is the manifest's sizeBytes
	SHA256   string // hex, of the JSON inside Gzip: browsers undo Content-Encoding: gzip before the client can hash
}

// Finish builds the trace after Box.Run returns, from Run's outcome and error. Run's error is expected when a writer stopped the run at a limit; any other error is returned as is.
func (r *Recorder) Finish(out Outcome, runErr error) (*Result, error) {
	if runErr != nil && (r.stop == nil || !errors.Is(runErr, r.stop)) {
		return nil, runErr
	}
	if r.stop != nil && !errors.Is(r.stop, errSizeLimit) && !errors.Is(r.stop, errOutputLimit) {
		return nil, r.stop
	}
	if r.hello == nil {
		return nil, r.malformed("stream ended before hello")
	}
	if r.exit != nil && len(r.partial) > 0 {
		return nil, r.malformed("bytes after exit")
	}

	if out.TimedOut && r.exit == nil {
		r.truncate(trace.SummaryTruncationReasonTimeLimit)
	}
	program := r.programExit(out)
	sum := trace.Summary{
		StepCount:  len(r.steps),
		Truncated:  r.truncation != nil,
		Truncation: r.truncation,
		Exit:       program,
	}
	if r.exit != nil && r.exit.LineHits != nil {
		source := trace.SummaryLineHitsSource(*r.exit.LineHitsSource)
		sum.LineHits, sum.LineHitsSource = r.exit.LineHits, &source
	} else {
		source := trace.SummaryLineHitsSourceTrace
		sum.LineHits, sum.LineHitsSource = stepHits(r.steps), &source
	}

	res := &Result{Steps: r.steps, Logs: r.logs}
	switch {
	case r.truncation != nil && r.truncation.Reason == trace.SummaryTruncationReasonStepLimit:
		completed := program.Kind == trace.ExitKindNormal || program.Kind == trace.ExitKindException || program.Kind == trace.ExitKindSignal
		sum.Exit = exitOf(trace.ExitKindStepLimit)
		sum.UntracedTail = &trace.UntracedTail{Completed: completed, Exit: program, StdoutBytes: r.tailStdout}
		res.Tail = r.tail
	case len(r.steps) > 0:
		last := &r.steps[len(r.steps)-1]
		last.Stdout += string(r.stdout)
		last.Stderr += string(r.stderr)
	}

	res.Header = Header{
		Version:  version,
		ID:       r.cfg.ID,
		Language: trace.Language{ID: r.hello.Language, Runtime: r.hello.Runtime, Adapter: r.hello.Adapter},
		Source:   r.cfg.Source,
		Options:  r.cfg.Options,
		Summary:  sum,
		Encoding: trace.Encoding{Mode: trace.EncodingModeDelta, KeyframeInterval: keyframeInterval},
	}
	return res, nil
}

func (r *Recorder) programExit(out Outcome) trace.Exit {
	switch {
	case errors.Is(r.stop, errOutputLimit):
		return exitOf(trace.ExitKindOutputLimit)
	case errors.Is(r.stop, errSizeLimit):
		return exitOf(trace.ExitKindStepLimit) // no exit kind for size_limit; step_limit is the trace-limit exit (FR-14)
	case r.exit != nil:
		return trace.Exit{
			Kind:    trace.ExitKind(r.exit.Kind),
			Code:    trace.ExitCode(r.exit.Code),
			Signal:  trace.ExitSignal(r.exit.Signal),
			Message: trace.ExitMessage(r.exit.Message),
		}
	case out.TimedOut:
		return exitOf(trace.ExitKindTimeout)
	case out.OutOfMemory:
		return exitOf(trace.ExitKindMemoryLimit)
	case out.Signal != 0:
		e, name := exitOf(trace.ExitKindSignal), signalName(out.Signal)
		e.Signal = &name
		return e
	default:
		e, code := exitOf(trace.ExitKindInternalError), out.Code
		e.Code = &code
		return e
	}
}

func exitOf(kind trace.ExitKind) trace.Exit {
	return trace.Exit{Kind: kind}
}

func stepHits(steps []trace.Step) map[string]int {
	hits := map[string]int{}
	for _, s := range steps {
		// a call step is the body's first line running
		if s.Event == trace.EventLine || s.Event == trace.EventCall {
			hits[strconv.Itoa(s.Line)]++
		}
	}
	return hits
}

// linux numbering: the sandbox runs linux even when vizctl runs on macOS
var signals = [...]string{
	1: "SIGHUP", 2: "SIGINT", 3: "SIGQUIT", 4: "SIGILL", 5: "SIGTRAP", 6: "SIGABRT", 7: "SIGBUS", 8: "SIGFPE",
	9: "SIGKILL", 10: "SIGUSR1", 11: "SIGSEGV", 12: "SIGUSR2", 13: "SIGPIPE", 14: "SIGALRM", 15: "SIGTERM",
	16: "SIGSTKFLT", 17: "SIGCHLD", 18: "SIGCONT", 19: "SIGSTOP", 20: "SIGTSTP", 21: "SIGTTIN", 22: "SIGTTOU",
	23: "SIGURG", 24: "SIGXCPU", 25: "SIGXFSZ", 26: "SIGVTALRM", 27: "SIGPROF", 28: "SIGWINCH", 29: "SIGIO",
	30: "SIGPWR", 31: "SIGSYS",
}

func signalName(n int) string {
	if n > 0 && n < len(signals) {
		return signals[n]
	}
	return "SIG" + strconv.Itoa(n)
}

// Trace returns the whole trace as one document.
func (res *Result) Trace() trace.Trace {
	h := res.Header
	return trace.Trace{
		Version:  h.Version,
		ID:       h.ID,
		Language: h.Language,
		Source:   h.Source,
		Options:  h.Options,
		Summary:  h.Summary,
		Encoding: h.Encoding,
		Steps:    res.Steps,
	}
}

// Chunks splits the steps into gzipped chunks of 250 (D2).
func (res *Result) Chunks() ([]Chunk, error) {
	var chunks []Chunk
	for from := 0; from < len(res.Steps); from += chunkSteps {
		to := min(from+chunkSteps, len(res.Steps))
		raw, err := json.Marshal(res.Steps[from:to])
		if err != nil {
			return nil, err
		}
		gz, sum, err := pack(raw)
		if err != nil {
			return nil, err
		}
		chunks = append(chunks, Chunk{Index: len(chunks), FromStep: from, ToStep: to - 1, Gzip: gz, SHA256: sum})
	}
	return chunks, nil
}

// TailGzip returns tail.txt.gz and the hex SHA-256 of the text in it.
func (res *Result) TailGzip() ([]byte, string, error) {
	return pack(res.Tail)
}

// pack gzips raw and hashes it before gzip: browsers undo Content-Encoding: gzip before the client can hash
func pack(raw []byte) ([]byte, string, error) {
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(raw); err != nil {
		return nil, "", err
	}
	if err := zw.Close(); err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(raw)
	return buf.Bytes(), hex.EncodeToString(sum[:]), nil
}
