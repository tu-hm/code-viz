package schema_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
)

const allFields = "testdata/trace/all-fields.json"

func TestTraceSchemaAcceptsExamples(t *testing.T) {
	sch := compile(t, "trace.v1.schema.json")
	fixtures, err := filepath.Glob("../fixtures/*/*/expected.trace.json")
	if err != nil {
		t.Fatal(err)
	}

	for _, path := range append(glob(t, "testdata/trace/*.json"), fixtures...) {
		t.Run(path, func(t *testing.T) {
			if err := sch.Validate(load(t, path)); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestTraceSchemaRequiresFields(t *testing.T) {
	sch := compile(t, "trace.v1.schema.json")
	paths := []string{
		"/version", "/id", "/language", "/source", "/options", "/summary", "/encoding", "/steps",
		"/language/id", "/language/runtime", "/language/adapter",
		"/source/file", "/source/lineCount",
		"/options/maxSteps", "/options/startAtLines",
		"/summary/stepCount", "/summary/truncated", "/summary/truncation", "/summary/exit",
		"/summary/truncation/reason", "/summary/truncation/atLine",
		"/summary/exit/kind", "/summary/exit/code", "/summary/exit/signal", "/summary/exit/message",
		"/summary/untracedTail/completed", "/summary/untracedTail/exit", "/summary/untracedTail/stdoutBytes",
		"/encoding/mode", "/encoding/keyframeInterval",
		"/steps/0/i", "/steps/0/event", "/steps/0/prevLine", "/steps/0/line", "/steps/0/keyframe", "/steps/0/stack",
		"/steps/0/frames", "/steps/0/heap", "/steps/0/removedObjects", "/steps/0/stdout", "/steps/0/stderr", "/steps/0/error",
		"/steps/2/error/type", "/steps/2/error/message", "/steps/2/error/line",
		"/steps/1/access/0/obj", "/steps/1/access/0/path", "/steps/1/access/0/mode",
		"/steps/0/stdinPos/bytes", "/steps/0/stdinPos/token", "/steps/0/stdinPos/inferred",
		"/steps/0/frames/f1/id", "/steps/0/frames/f1/name", "/steps/0/frames/f1/kind", "/steps/0/frames/f1/line",
		"/steps/0/frames/f1/locals", "/steps/0/frames/f1/returnValue",
		"/steps/0/frames/f1/locals/0/name", "/steps/0/frames/f1/locals/0/value",
		"/steps/0/heap/o1/window/start", "/steps/0/heap/o1/window/count",
		"/steps/0/heap/o1/sparse/default", "/steps/0/heap/o1/sparse/items",
		"/steps/0/heap/o3/entries/0/key", "/steps/0/heap/o3/entries/0/value",
		"/steps/0/heap/o4/fields/0/name", "/steps/0/heap/o4/fields/0/value",
	}

	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			doc := load(t, allFields)
			edit(t, doc, path, "")
			if err := sch.Validate(doc); err == nil {
				t.Fatal("trace is valid without the field")
			}
		})
	}
}

func TestTraceSchemaRejects(t *testing.T) {
	sch := compile(t, "trace.v1.schema.json")
	const (
		f0   = "/steps/0/frames/f0/locals/"
		f1   = "/steps/0/frames/f1/locals/"
		heap = "/steps/0/heap/"
	)
	tests := []struct {
		name  string
		path  string
		value string
	}{
		{"value without t", f1 + "0/value/t", unset},
		{"int value without v", f0 + "0/value/v", unset},
		{"float value without v", f1 + "5/value/v", unset},
		{"bool value without v", f1 + "6/value/v", unset},
		{"str value without v", f1 + "7/value/v", unset},
		{"char value without v", f1 + "4/value/v", unset},
		{"char value without code", f1 + "4/value/code", unset},
		{"ref value without id", f1 + "0/value/id", unset},
		{"ptr value without addr", f1 + "2/value/addr", unset},
		{"unavailable value without reason", f1 + "9/value/reason", unset},
		{"heap object without kind", heap + "o6/kind", unset},
		{"sequence without type", heap + "o2/type", unset},
		{"sequence without length", heap + "o2/length", unset},
		{"sequence without items, sparse or patch", heap + "o2/items", unset},
		{"sparse sequence without sparse", heap + "o1/sparse", unset},
		{"patched sequence without patch", "/steps/1/heap/o1/patch", unset},
		{"set without type", heap + "o5/type", unset},
		{"set without length", heap + "o5/length", unset},
		{"set without items", heap + "o5/items", unset},
		{"mapping without type", heap + "o3/type", unset},
		{"mapping without length", heap + "o3/length", unset},
		{"mapping without entries", heap + "o3/entries", unset},
		{"record without type", heap + "o4/type", unset},
		{"record without fields", heap + "o4/fields", unset},
		{"function without name", heap + "o6/name", unset},
		{"class without name", heap + "o7/name", unset},
		{"opaque without type", heap + "o8/type", unset},
		{"opaque without summary", heap + "o8/summary", unset},

		{"major version 2", "/version", `"2.0"`},
		{"id without trc_ prefix", "/id", `"viz_8c1f4e2a9b7d6c35"`},
		{"maxSteps above the 5,000 ceiling", "/options/maxSteps", `5001`},
		{"unknown exit kind", "/summary/exit/kind", `"crashed"`},
		{"unknown truncation reason", "/summary/truncation/reason", `"memory_limit"`},
		{"line 0 in lineHits", "/summary/lineHits", `{"0": 1}`},
		{"unknown lineHitsSource", "/summary/lineHitsSource", `"guess"`},
		{"unknown encoding mode", "/encoding/mode", `"full"`},
		{"unknown step event", "/steps/0/event", `"jump"`},
		{"line 0", "/steps/0/line", `0`},
		{"stack entry that is not a frame id", "/steps/0/stack/0", `"o1"`},
		{"heap key that is not an object id", "/steps/0/heap", `{"f1": {"kind": "class", "name": "Point"}}`},
		{"removed id that is not an object id", "/steps/1/removedObjects/0", `"f0"`},
		{"null parentCallId", "/steps/0/parentCallId", `null`},
		{"unknown access mode", "/steps/1/access/0/mode", `"rw"`},
		{"unknown frame kind", "/steps/0/frames/f1/kind", `"coroutine"`},
		{"null local value", f1 + "0/value", `null`},
		{"unknown value t", f1 + "0/value/t", `"tuple"`},
		{"number in v", f0 + "0/value/v", `200005`},
		{"pointer address without 0x", f1 + "2/value/addr", `"55555556aeb0"`},
		{"null pointer target", f1 + "2/value/target", `null`},
		{"unknown heap kind", heap + "o7/kind", `"module"`},
		{"negative sparse index", heap + "o1/sparse/items", `{"-1": {"t": "int", "v": "1"}}`},
		{"unknown error kind", "/steps/2/error/kind", `"crash"`},
		{"number in an error index", "/steps/2/error/values/index", `5`},
		{"error op that is not an operator", "/steps/2/error/values/op", `"<<"`},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			doc := load(t, allFields)
			edit(t, doc, tc.path, tc.value)
			if err := sch.Validate(doc); err == nil {
				t.Fatal("trace is valid")
			}
		})
	}
}

func TestTraceSchemaAllowsUnknownFields(t *testing.T) {
	sch := compile(t, "trace.v1.schema.json")
	objects := []string{
		"", "/language", "/summary", "/summary/exit", "/steps/0", "/steps/2/error", "/steps/2/error/values",
		"/steps/0/frames/f1", "/steps/0/frames/f1/locals/0", "/steps/0/frames/f1/locals/0/value",
		"/steps/0/heap/o2", "/steps/0/heap/o1/window",
	}

	for _, path := range objects {
		t.Run(path+"/futureField", func(t *testing.T) {
			doc := load(t, allFields)
			edit(t, doc, path+"/futureField", `{"added": "in 1.2"}`)
			if err := sch.Validate(doc); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestTraceTypesRoundTrip(t *testing.T) {
	for _, path := range glob(t, "testdata/trace/*.json") {
		t.Run(path, func(t *testing.T) {
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var tr trace.Trace
			if err := json.Unmarshal(raw, &tr); err != nil {
				t.Fatal(err)
			}
			out, err := json.Marshal(tr)
			if err != nil {
				t.Fatal(err)
			}

			var want, got any
			if err := json.Unmarshal(raw, &want); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(out, &got); err != nil {
				t.Fatal(err)
			}
			if diff := cmp.Diff(want, got); diff != "" {
				t.Errorf("round trip through trace.Trace changed the document (-want +got):\n%s", diff)
			}
		})
	}
}
