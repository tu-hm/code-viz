package schema_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/gen/wire"
)

const pythonSession = "testdata/wire/python.ndjson"

func TestWireSchemaAcceptsExamples(t *testing.T) {
	sch := compile(t, "wire.v1.schema.json")
	for _, path := range glob(t, "testdata/wire/*.ndjson") {
		for i, line := range lines(t, path) {
			t.Run(fmt.Sprintf("%s:%d", path, i+1), func(t *testing.T) {
				if err := sch.Validate(decodeJSON(t, line)); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestWireSchemaRejects(t *testing.T) {
	sch := compile(t, "wire.v1.schema.json")
	const hello, out, callStep, exceptionStep, log, exit = 0, 2, 3, 4, 5, 6
	tests := []struct {
		name  string
		line  int
		path  string
		value string
	}{
		{"message without type", hello, "/type", unset},
		{"unknown message type", hello, "/type", `"trace"`},
		{"hello without protocol", hello, "/protocol", unset},
		{"hello without language", hello, "/language", unset},
		{"hello without runtime", hello, "/runtime", unset},
		{"hello without adapter", hello, "/adapter", unset},
		{"protocol 2", hello, "/protocol", `2`},
		{"step without event", callStep, "/event", unset},
		{"step without line", callStep, "/line", unset},
		{"step without prevLine", callStep, "/prevLine", unset},
		{"step without stack", callStep, "/stack", unset},
		{"step without heap", callStep, "/heap", unset},
		{"step without error", callStep, "/error", unset},
		{"step with an empty stack", callStep, "/stack", `[]`},
		{"step with an unknown event", callStep, "/event", `"jump"`},
		{"frame without id", callStep, "/stack/1/id", unset},
		{"frame with an unknown kind", callStep, "/stack/1/kind", `"coroutine"`},
		{"ref value without id", callStep, "/stack/0/locals/0/value/id", unset},
		{"heap object with an unknown kind", callStep, "/heap/140234500001/kind", `"module"`},
		{"empty heap id", callStep, "/heap", `{"": {"kind": "class", "name": "A"}}`},
		{"stdinPos without bytes", callStep, "/stdinPos/bytes", unset},
		{"error without type", exceptionStep, "/error/type", unset},
		{"error without message", exceptionStep, "/error/message", unset},
		{"error without line", exceptionStep, "/error/line", unset},
		{"error with an unknown kind", exceptionStep, "/error/kind", `"crash"`},
		{"out without stream", out, "/stream", unset},
		{"out without data", out, "/data", unset},
		{"out to an unknown stream", out, "/stream", `"stdlog"`},
		{"exit without kind", exit, "/kind", unset},
		{"exit without code", exit, "/code", unset},
		{"exit without signal", exit, "/signal", unset},
		{"exit without message", exit, "/message", unset},
		{"exit with an unknown kind", exit, "/kind", `"crashed"`},
		{"exit with a hit count for line 0", exit, "/lineHits", `{"0": 1}`},
		{"exit with a negative hit count", exit, "/lineHits/13", `-1`},
		{"exit with hit counts but no source", exit, "/lineHitsSource", unset},
		{"exit with a hit source but no counts", exit, "/lineHits", unset},
		{"exit with hit counts from the trace", exit, "/lineHitsSource", `"trace"`},
		{"log without level", log, "/level", unset},
		{"log without message", log, "/message", unset},
		{"log with an unknown level", log, "/level", `"trace"`},
	}

	msgs := lines(t, pythonSession)
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			msg := decodeJSON(t, msgs[tc.line])
			edit(t, msg, tc.path, tc.value)
			if err := sch.Validate(msg); err == nil {
				t.Fatal("message is valid")
			}
		})
	}
}

func TestWireSchemaAllowsUnknownFields(t *testing.T) {
	sch := compile(t, "wire.v1.schema.json")
	const hello, callStep = 0, 3
	tests := []struct {
		line int
		path string
	}{
		{hello, "/futureField"},
		{callStep, "/futureField"},
		{callStep, "/stack/1/futureField"},
	}

	msgs := lines(t, pythonSession)
	for _, tc := range tests {
		t.Run(fmt.Sprintf("line %d %s", tc.line+1, tc.path), func(t *testing.T) {
			msg := decodeJSON(t, msgs[tc.line])
			edit(t, msg, tc.path, `{"added": "in 1.2"}`)
			if err := sch.Validate(msg); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestWireTypesRoundTrip(t *testing.T) {
	for _, path := range glob(t, "testdata/wire/*.ndjson") {
		for i, line := range lines(t, path) {
			t.Run(fmt.Sprintf("%s:%d", path, i+1), func(t *testing.T) {
				var head wire.Message
				if err := json.Unmarshal([]byte(line), &head); err != nil {
					t.Fatal(err)
				}
				msg := map[wire.MessageType]any{
					wire.MessageTypeHello: &wire.Hello{},
					wire.MessageTypeStep:  &wire.Step{},
					wire.MessageTypeOut:   &wire.Out{},
					wire.MessageTypeExit:  &wire.Exit{},
					wire.MessageTypeLog:   &wire.Log{},
				}[head.Type]
				if err := json.Unmarshal([]byte(line), msg); err != nil {
					t.Fatal(err)
				}
				out, err := json.Marshal(msg)
				if err != nil {
					t.Fatal(err)
				}

				var want, got map[string]any
				if err := json.Unmarshal([]byte(line), &want); err != nil {
					t.Fatal(err)
				}
				if err := json.Unmarshal(out, &got); err != nil {
					t.Fatal(err)
				}
				delete(want, "type")
				if diff := cmp.Diff(want, got); diff != "" {
					t.Errorf("round trip through the %s type changed the message (-want +got):\n%s", head.Type, diff)
				}
			})
		}
	}
}
