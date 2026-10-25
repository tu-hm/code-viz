package tracecore_test

import (
	"encoding/json"
	"fmt"
	"io"
	"sync"
	"testing"

	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/gen/wire"
	"github.com/tu-hm/code-viz/backend/internal/tracecore"
	"github.com/tu-hm/code-viz/backend/schema"
)

var compiled = sync.OnceValues(schema.New)

func validator(t testing.TB) *schema.Validator {
	t.Helper()
	v, err := compiled()
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func config(t testing.TB, maxSteps int, lim tracecore.Limits) tracecore.Config {
	t.Helper()
	return tracecore.Config{
		ID:       "trc_0",
		Source:   trace.Source{File: "main.py", LineCount: 20},
		Options:  trace.Options{MaxSteps: maxSteps, StartAtLines: []int{}},
		Limits:   lim,
		Validate: validator(t).Wire,
	}
}

type write struct {
	fd   int
	data string
}

func wireLines(lines ...string) []write {
	var ws []write
	for _, l := range lines {
		ws = append(ws, write{3, l + "\n"})
	}
	return ws
}

func feed(rec *tracecore.Recorder, writes []write) error {
	writers := []io.Writer{1: rec.Stdout(), 2: rec.Stderr(), 3: rec.Wire()}
	for _, w := range writes {
		if _, err := writers[w.fd].Write([]byte(w.data)); err != nil {
			return fmt.Errorf("run trace: %w", err)
		}
	}
	return nil
}

func record(t *testing.T, cfg tracecore.Config, out tracecore.Outcome, writes []write) (*tracecore.Result, error) {
	t.Helper()
	rec := tracecore.NewRecorder(cfg)
	return rec.Finish(out, feed(rec, writes))
}

func mustRecord(t *testing.T, cfg tracecore.Config, out tracecore.Outcome, writes []write) *tracecore.Result {
	t.Helper()
	res, err := record(t, cfg, out, writes)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

const helloLine = `{"type":"hello","protocol":1,"language":"python3","runtime":"CPython 3.12.4","adapter":"test/1"}`

func exitLine(kind string, code int) string {
	return fmt.Sprintf(`{"type":"exit","kind":%q,"code":%d,"signal":null,"message":null}`, kind, code)
}

func outLine(stream, data string) string {
	return message("out", wire.Out{Stream: wire.OutStream(stream), Data: data})
}

func stepLine(line int, stack []trace.Frame, heap map[string]trace.HeapObject) string {
	if heap == nil {
		heap = map[string]trace.HeapObject{}
	}
	return message("step", wire.Step{Event: trace.EventLine, Line: line, Stack: stack, Heap: heap})
}

func message(typ string, msg any) string {
	b, err := json.Marshal(msg)
	if err != nil {
		panic(err)
	}
	return `{"type":"` + typ + `",` + string(b[1:])
}

func intv(v string) trace.Value { return trace.Value{T: trace.ValueTInt, V: &v} }

func str(v string) trace.Value { return trace.Value{T: trace.ValueTStr, V: &v} }

func ref(id string) trace.Value { return trace.Value{T: trace.ValueTRef, ID: &id} }

func ptr(addr, target string) trace.Value {
	return trace.Value{T: trace.ValueTPtr, Addr: &addr, Target: &target}
}

func list(items ...trace.Value) trace.HeapObject {
	if items == nil {
		items = []trace.Value{}
	}
	typ, n := "list", len(items)
	return trace.HeapObject{Kind: trace.HeapObjectKindSequence, Type: &typ, Length: &n, Items: items}
}

func local(name string, v trace.Value) trace.Local { return trace.Local{Name: name, Value: v} }

func frame(id, name string, line int, locals ...trace.Local) trace.Frame {
	kind := trace.FrameKindFunction
	if name == "<module>" {
		kind = trace.FrameKindGlobal
	}
	if locals == nil {
		locals = []trace.Local{}
	}
	return trace.Frame{ID: id, Name: name, Kind: kind, Line: line, Locals: locals}
}
