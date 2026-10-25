package tracecore_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"

	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/gen/wire"
	"github.com/tu-hm/code-viz/backend/internal/tracecore"
)

func delta(i, line int, frames map[string]trace.Frame, heap map[string]trace.HeapObject, removed ...string) trace.Step {
	if frames == nil {
		frames = map[string]trace.Frame{}
	}
	if heap == nil {
		heap = map[string]trace.HeapObject{}
	}
	if removed == nil {
		removed = []string{}
	}
	return trace.Step{
		I: i, Event: trace.EventLine, Line: line, Keyframe: i%50 == 0, Stack: []string{"f0"},
		Frames: frames, Heap: heap, RemovedObjects: removed,
	}
}

func TestIDsFollowFirstAppearance(t *testing.T) {
	writes := wireLines(
		helloLine,
		stepLine(1, []trace.Frame{frame("m", "<module>", 1, local("a", ref("100")), local("p", ptr("0x10", "300")))},
			map[string]trace.HeapObject{"100": list(ref("200")), "200": list(intv("1")), "300": list(), "999": list()}),
		stepLine(5, []trace.Frame{
			frame("m", "<module>", 2, local("b", ref("400")), local("a", ref("100"))),
			frame("7", "sq", 5, local("x", intv("3"))),
		}, map[string]trace.HeapObject{"400": list(ref("300")), "100": list(ref("200")), "200": list(intv("1")), "300": list()}),
		exitLine("normal", 0),
	)
	res := mustRecord(t, config(t, 1000, tracecore.DefaultLimits), tracecore.Outcome{}, writes)

	first := delta(0, 1,
		map[string]trace.Frame{"f0": frame("f0", "<module>", 1, local("a", ref("o1")), local("p", ptr("0x10", "o2")))},
		map[string]trace.HeapObject{"o1": list(ref("o3")), "o2": list(), "o3": list(intv("1"))})
	second := delta(1, 5,
		map[string]trace.Frame{
			"f0": frame("f0", "<module>", 2, local("b", ref("o4")), local("a", ref("o1"))),
			"f1": frame("f1", "sq", 5, local("x", intv("3"))),
		},
		map[string]trace.HeapObject{"o4": list(ref("o2"))})
	second.Stack = []string{"f0", "f1"}
	if diff := cmp.Diff([]trace.Step{first, second}, res.Steps); diff != "" {
		t.Errorf("steps (-want +got):\n%s", diff)
	}
}

func TestDeltasCarryOnlyChanges(t *testing.T) {
	both := []trace.Frame{frame("m", "<module>", 1, local("a", ref("x")), local("b", ref("y")))}
	onlyA := []trace.Frame{frame("m", "<module>", 1, local("a", ref("x")))}
	lines := []string{
		helloLine,
		stepLine(1, both, map[string]trace.HeapObject{"x": list(intv("1")), "y": list(intv("2"))}),
		stepLine(2, both, map[string]trace.HeapObject{"x": list(intv("1")), "y": list(intv("2"))}),
		stepLine(3, both, map[string]trace.HeapObject{"x": list(intv("1")), "y": list(intv("9"))}),
	}
	for line := 4; line <= 52; line++ {
		lines = append(lines, stepLine(line, onlyA, map[string]trace.HeapObject{"x": list(intv("1"))}))
	}
	res := mustRecord(t, config(t, 1000, tracecore.DefaultLimits), tracecore.Outcome{}, wireLines(append(lines, exitLine("normal", 0))...))

	f0 := frame("f0", "<module>", 1, local("a", ref("o1")))
	want := map[int]trace.Step{
		1:  delta(1, 2, nil, nil),
		2:  delta(2, 3, nil, map[string]trace.HeapObject{"o2": list(intv("9"))}),
		3:  delta(3, 4, map[string]trace.Frame{"f0": f0}, nil, "o2"),
		49: delta(49, 50, nil, nil),
		50: delta(50, 51, map[string]trace.Frame{"f0": f0}, map[string]trace.HeapObject{"o1": list(intv("1"))}),
		51: delta(51, 52, nil, nil),
	}
	for i, w := range want {
		if diff := cmp.Diff(w, res.Steps[i]); diff != "" {
			t.Errorf("step %d (-want +got):\n%s", i, diff)
		}
	}
}

func TestShowInternals(t *testing.T) {
	internal := true
	hidden := trace.Local{Name: "__for_range", Value: ref("1"), Internal: &internal}
	lines := wireLines(
		helloLine,
		stepLine(1, []trace.Frame{frame("m", "<module>", 1, hidden, local("y", intv("2")))}, map[string]trace.HeapObject{"1": list()}),
		exitLine("normal", 0),
	)
	tests := []struct {
		name   string
		show   bool
		locals []string
		heap   int
	}{
		{"internal locals and their objects are dropped by default", false, []string{"y"}, 0},
		{"showInternals keeps internal locals", true, []string{"__for_range", "y"}, 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := config(t, 1000, tracecore.DefaultLimits)
			cfg.Options.ShowInternals = &tc.show
			step := mustRecord(t, cfg, tracecore.Outcome{}, lines).Steps[0]
			var names []string
			for _, l := range step.Frames["f0"].Locals {
				names = append(names, l.Name)
			}
			if diff := cmp.Diff(tc.locals, names); diff != "" {
				t.Errorf("locals (-want +got):\n%s", diff)
			}
			if len(step.Heap) != tc.heap {
				t.Errorf("heap has %d objects, want %d", len(step.Heap), tc.heap)
			}
		})
	}
}

var ignoreHits = cmpopts.IgnoreFields(trace.Summary{}, "LineHits", "LineHitsSource")

func TestStepLimit(t *testing.T) {
	steps := []string{
		stepLine(1, []trace.Frame{frame("m", "<module>", 1)}, nil),
		stepLine(2, []trace.Frame{frame("m", "<module>", 2)}, nil),
		stepLine(3, []trace.Frame{frame("m", "<module>", 3)}, nil),
	}
	marker := stepLine(4, []trace.Frame{frame("m", "<module>", 4)}, nil)
	exitWithHits := `{"type":"exit","kind":"normal","code":0,"signal":null,"message":null,"lineHits":{"1":1,"4":7},"lineHitsSource":"counter"}`
	code0, line3 := 0, 3
	normal := trace.Exit{Kind: trace.ExitKindNormal, Code: &code0}
	counter, fromSteps := trace.SummaryLineHitsSourceCounter, trace.SummaryLineHitsSourceTrace

	past := wireLines(helloLine, steps[0], steps[1], steps[2])
	past = append(past, write{1, "x"})
	past = append(past, wireLines(marker, marker, outLine("stdout", "yz"))...)
	past = append(past, write{2, "e"})
	past = append(past, wireLines(exitWithHits)...)

	tests := []struct {
		name    string
		writes  []write
		summary trace.Summary
		tail    string
	}{
		{
			name:    "maxSteps steps are not truncated",
			writes:  wireLines(append(append([]string{helloLine}, steps...), exitLine("normal", 0))...),
			summary: trace.Summary{StepCount: 3, Exit: normal, LineHits: map[string]int{"1": 1, "2": 1, "3": 1}, LineHitsSource: &fromSteps},
		},
		{
			name:   "a step past maxSteps truncates and the rest goes to the untraced tail",
			writes: past,
			summary: trace.Summary{
				StepCount:      3,
				Truncated:      true,
				Truncation:     &trace.SummaryTruncation{Reason: trace.SummaryTruncationReasonStepLimit, AtLine: &line3},
				Exit:           trace.Exit{Kind: trace.ExitKindStepLimit},
				LineHits:       map[string]int{"1": 1, "4": 7},
				LineHitsSource: &counter,
				UntracedTail:   &trace.UntracedTail{Completed: true, Exit: normal, StdoutBytes: 3},
			},
			tail: "xyze",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res := mustRecord(t, config(t, 3, tracecore.DefaultLimits), tracecore.Outcome{}, tc.writes)
			if diff := cmp.Diff(tc.summary, res.Header.Summary); diff != "" {
				t.Errorf("summary (-want +got):\n%s", diff)
			}
			if string(res.Tail) != tc.tail {
				t.Errorf("tail = %q, want %q", res.Tail, tc.tail)
			}
			if got := res.Steps[len(res.Steps)-1].Stdout; got != "" {
				t.Errorf("last step stdout = %q, want the tail to keep it", got)
			}
		})
	}
}

func TestOutputWithoutAStepGoesToTheTail(t *testing.T) {
	writes := append(wireLines(helloLine), write{1, "out"}, write{2, "err"})
	res := mustRecord(t, config(t, 3, tracecore.DefaultLimits), tracecore.Outcome{}, append(writes, wireLines(exitLine("normal", 0))...))
	if string(res.Tail) != "outerr" || len(res.Steps) != 0 || res.Header.Summary.UntracedTail != nil {
		t.Errorf("tail %q, %d steps, untracedTail %+v; want tail \"outerr\", no steps and no untracedTail", res.Tail, len(res.Steps), res.Header.Summary.UntracedTail)
	}
}

func TestStepCountCountsRecordedStepsOnly(t *testing.T) {
	rec := tracecore.NewRecorder(config(t, 2, tracecore.DefaultLimits))
	var got []int
	for line := range 4 {
		msg := helloLine
		if line > 0 {
			msg = stepLine(line, []trace.Frame{frame("m", "<module>", line)}, nil)
		}
		if _, err := rec.Wire().Write([]byte(msg + "\n")); err != nil {
			t.Fatal(err)
		}
		got = append(got, rec.StepCount())
	}
	if diff := cmp.Diff([]int{0, 1, 2, 2}, got); diff != "" {
		t.Errorf("step count after each message (-want +got):\n%s", diff)
	}
}

func TestTraceSizeLimit(t *testing.T) {
	writes := wireLines(
		helloLine,
		stepLine(1, []trace.Frame{frame("m", "<module>", 1, local("a", intv("1")))}, nil),
		stepLine(2, []trace.Frame{frame("m", "<module>", 2, local("a", intv("2")))}, nil),
		stepLine(3, []trace.Frame{frame("m", "<module>", 3, local("a", intv("3")))}, nil),
		exitLine("normal", 0),
	)
	full := mustRecord(t, config(t, 1000, tracecore.DefaultLimits), tracecore.Outcome{}, writes)
	size := 0
	for _, st := range full.Steps {
		b, err := json.Marshal(st)
		if err != nil {
			t.Fatal(err)
		}
		size += len(b)
	}

	code0, line2 := 0, 2
	tests := []struct {
		name    string
		bytes   int
		summary trace.Summary
	}{
		{"steps that fill the budget exactly are kept", size, trace.Summary{StepCount: 3, Exit: trace.Exit{Kind: trace.ExitKindNormal, Code: &code0}}},
		{"the step that goes over the budget ends the trace", size - 1, trace.Summary{
			StepCount:  2,
			Truncated:  true,
			Truncation: &trace.SummaryTruncation{Reason: trace.SummaryTruncationReasonSizeLimit, AtLine: &line2},
			Exit:       trace.Exit{Kind: trace.ExitKindStepLimit},
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			lim := tracecore.DefaultLimits
			lim.TraceBytes = tc.bytes
			res := mustRecord(t, config(t, 1000, lim), tracecore.Outcome{}, writes)
			if diff := cmp.Diff(tc.summary, res.Header.Summary, ignoreHits); diff != "" {
				t.Errorf("summary (-want +got):\n%s", diff)
			}
		})
	}
}

func TestWireLineLongerThanTheTraceBudgetHitsSizeLimit(t *testing.T) {
	const budget = 1000
	logOf := func(n int) string {
		head := `{"type":"log","level":"debug","message":"`
		return head + strings.Repeat("x", n-len(head)-2) + `"}`
	}
	step := stepLine(1, []trace.Frame{frame("m", "<module>", 1)}, nil)
	tests := []struct {
		name      string
		writes    []write
		truncated bool
	}{
		{"line of exactly the budget", wireLines(helloLine, logOf(budget), step, exitLine("normal", 0)), false},
		{"line one byte over the budget", wireLines(helloLine, logOf(budget+1), step, exitLine("normal", 0)), true},
		{"unterminated line of exactly the budget", append(wireLines(helloLine), write{3, logOf(budget)}, write{3, "\n" + step + "\n" + exitLine("normal", 0) + "\n"}), false},
		{"unterminated line one byte over the budget", append(wireLines(helloLine), write{3, logOf(budget + 1)}), true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			lim := tracecore.DefaultLimits
			lim.TraceBytes = budget
			res := mustRecord(t, config(t, 1000, lim), tracecore.Outcome{}, tc.writes)
			sum := res.Header.Summary
			if tc.truncated && (sum.Truncation == nil || sum.Truncation.Reason != trace.SummaryTruncationReasonSizeLimit || sum.StepCount != 0) {
				t.Errorf("summary = %+v, want size_limit with no steps", sum)
			}
			if !tc.truncated && (sum.Truncated || sum.StepCount != 1) {
				t.Errorf("summary = %+v, want one step and no truncation", sum)
			}
		})
	}
}

func TestOutputLimit(t *testing.T) {
	step := stepLine(1, []trace.Frame{frame("m", "<module>", 1)}, nil)
	tests := []struct {
		name           string
		stderr         string
		kind           trace.ExitKind
		stdout, stdErr string
	}{
		{"output up to the limit is kept", "67890", trace.ExitKindNormal, "12345", "67890"},
		{"output past the limit is cut and ends the run", "678901", trace.ExitKindOutputLimit, "12345", "67890"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			lim := tracecore.DefaultLimits
			lim.OutputBytes = 10
			writes := wireLines(helloLine)
			writes = append(writes, write{1, "12345"})
			writes = append(writes, wireLines(step)...)
			writes = append(writes, write{2, tc.stderr})
			writes = append(writes, wireLines(exitLine("normal", 0))...)
			res := mustRecord(t, config(t, 1000, lim), tracecore.Outcome{}, writes)
			if got := res.Header.Summary.Exit.Kind; got != tc.kind {
				t.Errorf("exit kind = %s, want %s", got, tc.kind)
			}
			st := res.Steps[0]
			if st.Stdout != tc.stdout || st.Stderr != tc.stdErr {
				t.Errorf("step output = %q, %q; want %q, %q", st.Stdout, st.Stderr, tc.stdout, tc.stdErr)
			}
		})
	}
}

func TestHeapObjectLimit(t *testing.T) {
	heap := map[string]trace.HeapObject{"1": list(), "2": list(), "3": list()}
	reason, typ := "object_limit", "list"
	unavailable := trace.Value{T: trace.ValueTUnavailable, Reason: &reason, Type: &typ}
	named := func(v trace.Value) trace.Value { v.Type = &typ; return v }
	addr := "0x30"
	tests := []struct {
		name   string
		locals []trace.Local
		want   []trace.Local
		heap   []string
	}{
		{
			name:   "objects up to the limit are kept",
			locals: []trace.Local{local("a", ref("1")), local("b", ref("2")), local("p", ptr("0x20", "2"))},
			want:   []trace.Local{local("a", ref("o1")), local("b", ref("o2")), local("p", ptr("0x20", "o2"))},
			heap:   []string{"o1", "o2"},
		},
		{
			name:   "objects past the limit are not followed",
			locals: []trace.Local{local("a", ref("1")), local("b", ref("2")), local("c", named(ref("3"))), local("p", ptr("0x30", "3"))},
			want:   []trace.Local{local("a", ref("o1")), local("b", ref("o2")), local("c", unavailable), local("p", trace.Value{T: trace.ValueTPtr, Addr: &addr})},
			heap:   []string{"o1", "o2"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			lim := tracecore.DefaultLimits
			lim.HeapObjects = 2
			writes := wireLines(helloLine, stepLine(1, []trace.Frame{frame("m", "<module>", 1, tc.locals...)}, heap), exitLine("normal", 0))
			step := mustRecord(t, config(t, 1000, lim), tracecore.Outcome{}, writes).Steps[0]
			if diff := cmp.Diff(tc.want, step.Frames["f0"].Locals); diff != "" {
				t.Errorf("locals (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(tc.heap, slices.Sorted(maps.Keys(step.Heap))); diff != "" {
				t.Errorf("heap ids (-want +got):\n%s", diff)
			}
		})
	}
}

func TestFrameLimit(t *testing.T) {
	global := frame("g", "<module>", 1)
	fn := func(id string) trace.Frame { return frame(id, "fn"+id, 1) }
	tests := []struct {
		name  string
		stack []trace.Frame
		want  []string
	}{
		{"global frame plus the limit is kept whole", []trace.Frame{global, fn("1"), fn("2")}, []string{"<module>", "fn1", "fn2"}},
		{"global frame plus the innermost frames", []trace.Frame{global, fn("1"), fn("2"), fn("3")}, []string{"<module>", "fn2", "fn3"}},
		{"innermost frames when there is no global frame", []trace.Frame{fn("1"), fn("2"), fn("3")}, []string{"fn2", "fn3"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			lim := tracecore.DefaultLimits
			lim.Frames = 2
			step := mustRecord(t, config(t, 1000, lim), tracecore.Outcome{}, wireLines(helloLine, stepLine(1, tc.stack, nil), exitLine("normal", 0))).Steps[0]
			var names []string
			for _, id := range step.Stack {
				names = append(names, step.Frames[id].Name)
			}
			if diff := cmp.Diff(tc.want, names); diff != "" {
				t.Errorf("frames (-want +got):\n%s", diff)
			}
		})
	}
}

func TestStringLimit(t *testing.T) {
	truncated, four, five, nine := true, 4, 5, 9
	cut := func(v string, n *int) trace.Value { s := str(v); s.Truncated, s.Len = &truncated, n; return s }
	withLen := func(v string, n *int) trace.Value { s := str(v); s.Len = n; return s }
	tests := []struct {
		name    string
		in, out trace.Value
	}{
		{"string at the limit is kept", str("abc"), str("abc")},
		{"string past the limit is cut", str("abcd"), cut("abc", &four)},
		{"limit counts characters, not bytes", str("héllo"), cut("hél", &five)},
		{"adapter's real length is kept", withLen("abcd", &nine), cut("abc", &nine)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			lim := tracecore.DefaultLimits
			lim.StringChars = 3
			writes := wireLines(helloLine, stepLine(1, []trace.Frame{frame("m", "<module>", 1, local("s", tc.in))}, nil), exitLine("normal", 0))
			step := mustRecord(t, config(t, 1000, lim), tracecore.Outcome{}, writes).Steps[0]
			if diff := cmp.Diff(tc.out, step.Frames["f0"].Locals[0].Value); diff != "" {
				t.Errorf("value (-want +got):\n%s", diff)
			}
		})
	}
}

func TestItemsLimit(t *testing.T) {
	truncated, typ := true, "dict"
	mapping := func(n int) trace.HeapObject {
		o := trace.HeapObject{Kind: trace.HeapObjectKindMapping, Type: &typ, Length: &n, Entries: []trace.Entry{}}
		for i := range n {
			o.Entries = append(o.Entries, trace.Entry{Key: str(string(rune('a' + i))), Value: intv("0")})
		}
		return o
	}
	cutList := list(intv("1"), intv("2"))
	three := 3
	cutList.Length, cutList.Truncated = &three, &truncated
	cutMap := mapping(2)
	cutMap.Length, cutMap.Truncated = &three, &truncated
	tests := []struct {
		name    string
		in, out trace.HeapObject
	}{
		{"sequence at the limit is kept", list(intv("1"), intv("2")), list(intv("1"), intv("2"))},
		{"sequence past the limit is cut", list(intv("1"), intv("2"), intv("3")), cutList},
		{"mapping at the limit is kept", mapping(2), mapping(2)},
		{"mapping past the limit is cut", mapping(3), cutMap},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			lim := tracecore.DefaultLimits
			lim.Items = 2
			writes := wireLines(helloLine, stepLine(1, []trace.Frame{frame("m", "<module>", 1, local("a", ref("1")))}, map[string]trace.HeapObject{"1": tc.in}), exitLine("normal", 0))
			step := mustRecord(t, config(t, 1000, lim), tracecore.Outcome{}, writes).Steps[0]
			if diff := cmp.Diff(tc.out, step.Heap["o1"]); diff != "" {
				t.Errorf("object (-want +got):\n%s", diff)
			}
		})
	}
}

func TestExitMapping(t *testing.T) {
	steps := []string{
		helloLine,
		stepLine(1, []trace.Frame{frame("m", "<module>", 1)}, nil),
		stepLine(2, []trace.Frame{frame("m", "<module>", 2)}, nil),
	}
	code0, code1, line2 := 0, 1, 2
	segv := "SIGSEGV"
	tests := []struct {
		name    string
		exit    string
		out     tracecore.Outcome
		summary trace.Summary
	}{
		{"tracer's exit wins over the sandbox's", exitLine("exception", 1), tracecore.Outcome{Code: 1},
			trace.Summary{StepCount: 2, Exit: trace.Exit{Kind: trace.ExitKindException, Code: &code1}}},
		{"time limit after the tracer's exit is ignored", exitLine("normal", 0), tracecore.Outcome{TimedOut: true},
			trace.Summary{StepCount: 2, Exit: trace.Exit{Kind: trace.ExitKindNormal, Code: &code0}}},
		{"time limit keeps the steps so far", "", tracecore.Outcome{TimedOut: true}, trace.Summary{
			StepCount:  2,
			Truncated:  true,
			Truncation: &trace.SummaryTruncation{Reason: trace.SummaryTruncationReasonTimeLimit, AtLine: &line2},
			Exit:       trace.Exit{Kind: trace.ExitKindTimeout},
		}},
		{"memory limit", "", tracecore.Outcome{Signal: 9, OutOfMemory: true},
			trace.Summary{StepCount: 2, Exit: trace.Exit{Kind: trace.ExitKindMemoryLimit}}},
		{"signal without the tracer's exit", "", tracecore.Outcome{Signal: 11},
			trace.Summary{StepCount: 2, Exit: trace.Exit{Kind: trace.ExitKindSignal, Signal: &segv}}},
		{"stream that ends without exit or a limit", "", tracecore.Outcome{Code: 0},
			trace.Summary{StepCount: 2, Exit: trace.Exit{Kind: trace.ExitKindInternalError, Code: &code0}}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			lines := slices.Clone(steps)
			if tc.exit != "" {
				lines = append(lines, tc.exit)
			}
			res := mustRecord(t, config(t, 1000, tracecore.DefaultLimits), tc.out, wireLines(lines...))
			if diff := cmp.Diff(tc.summary, res.Header.Summary, ignoreHits); diff != "" {
				t.Errorf("summary (-want +got):\n%s", diff)
			}
		})
	}
}

func TestUntracedTailAfterATimeLimit(t *testing.T) {
	lines := []string{helloLine}
	for line := 1; line <= 3; line++ {
		lines = append(lines, stepLine(line, []trace.Frame{frame("m", "<module>", line)}, nil))
	}
	res := mustRecord(t, config(t, 2, tracecore.DefaultLimits), tracecore.Outcome{TimedOut: true}, wireLines(lines...))

	line2 := 2
	want := trace.Summary{
		StepCount:    2,
		Truncated:    true,
		Truncation:   &trace.SummaryTruncation{Reason: trace.SummaryTruncationReasonStepLimit, AtLine: &line2},
		Exit:         trace.Exit{Kind: trace.ExitKindStepLimit},
		UntracedTail: &trace.UntracedTail{Completed: false, Exit: trace.Exit{Kind: trace.ExitKindTimeout}},
	}
	if diff := cmp.Diff(want, res.Header.Summary, ignoreHits); diff != "" {
		t.Errorf("summary (-want +got):\n%s", diff)
	}
}

func TestOutputGoesToTheNextStep(t *testing.T) {
	writes := []write{{1, "a"}}
	writes = append(writes, wireLines(helloLine)...)
	writes = append(writes, write{1, "b"})
	writes = append(writes, wireLines(stepLine(1, []trace.Frame{frame("m", "<module>", 1)}, nil), outLine("stdout", "c"))...)
	writes = append(writes, write{2, "e"})
	writes = append(writes, wireLines(stepLine(2, []trace.Frame{frame("m", "<module>", 2)}, nil))...)
	writes = append(writes, write{1, "d"})
	writes = append(writes, wireLines(exitLine("normal", 0))...)
	writes = append(writes, write{1, "f"})
	res := mustRecord(t, config(t, 1000, tracecore.DefaultLimits), tracecore.Outcome{}, writes)

	var got [][2]string
	for _, st := range res.Steps {
		got = append(got, [2]string{st.Stdout, st.Stderr})
	}
	want := [][2]string{{"ab", ""}, {"cdf", "e"}}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("stdout, stderr per step (-want +got):\n%s", diff)
	}
}

func TestReadsBecomeAccess(t *testing.T) {
	heap := map[string]trace.HeapObject{"1": list(intv("7")), "2": list(intv("8"), intv("9")), "3": list(intv("1"))}
	locals := []trace.Local{local("a", ref("1")), local("b", ref("2")), local("c", ref("3"))}
	read := func(obj string, index int) wire.StepReadsElem { return wire.StepReadsElem{Obj: obj, Index: index} }
	access := func(obj string, index int) trace.Access {
		return trace.Access{Obj: obj, Path: []int{index}, Mode: trace.AccessModeR}
	}
	tests := []struct {
		name    string
		reads   []wire.StepReadsElem
		objects int
		cells   int
		want    []trace.Access
	}{
		{name: "no reads recorded means no access", reads: nil, want: nil},
		{name: "reads recorded but none made is an empty access", reads: []wire.StepReadsElem{}, want: []trace.Access{}},
		{
			name:  "reads name trace ids, first read first, each cell once",
			reads: []wire.StepReadsElem{read("2", 1), read("1", 0), read("2", 1), read("2", 0)},
			want:  []trace.Access{access("o2", 1), access("o1", 0), access("o2", 0)},
		},
		{
			name:    "reads of objects past the heap budget are dropped",
			reads:   []wire.StepReadsElem{read("3", 0), read("1", 0)},
			objects: 2,
			want:    []trace.Access{access("o1", 0)},
		},
		{name: "reads up to the limit are kept", reads: []wire.StepReadsElem{read("2", 0), read("2", 1)}, cells: 2, want: []trace.Access{access("o2", 0), access("o2", 1)}},
		{name: "more reads than the limit are dropped whole", reads: []wire.StepReadsElem{read("2", 0), read("2", 1), read("1", 0)}, cells: 2, want: nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			lim := tracecore.DefaultLimits
			if tc.objects > 0 {
				lim.HeapObjects = tc.objects
			}
			if tc.cells > 0 {
				lim.Reads = tc.cells
			}
			st := wire.Step{Event: trace.EventLine, Line: 1, Stack: []trace.Frame{frame("m", "<module>", 1, locals...)}, Heap: heap, Reads: tc.reads}
			writes := wireLines(helloLine, message("step", st), exitLine("normal", 0))
			got := mustRecord(t, config(t, 1000, lim), tracecore.Outcome{}, writes).Steps[0].Access
			if diff := cmp.Diff(tc.want, got); diff != "" {
				t.Errorf("access (-want +got):\n%s", diff)
			}
		})
	}
}

func TestMalformedInputFails(t *testing.T) {
	step := stepLine(1, []trace.Frame{frame("m", "<module>", 1)}, nil)
	exit := exitLine("normal", 0)
	tests := []struct {
		name   string
		writes []write
	}{
		{"step before hello", wireLines(step, helloLine, exit)},
		{"second hello", wireLines(helloLine, helloLine, exit)},
		{"step after exit", wireLines(helloLine, exit, step)},
		{"out after exit", wireLines(helloLine, exit, outLine("stdout", "SECRET"))},
		{"line that is not JSON", wireLines(helloLine, "SECRET", exit)},
		{"message that fails the schema", wireLines(helloLine, stepLine(1, []trace.Frame{frame("m", "<module>", 1, local("p", ptr("SECRET", "1")))}, map[string]trace.HeapObject{"1": list()}), exit)},
		{"reference to an object missing from heap", wireLines(helloLine, stepLine(1, []trace.Frame{frame("m", "<module>", 1, local("a", ref("SECRET")))}, nil), exit)},
		{"ref id cleared by a key that differs in case", wireLines(helloLine,
			`{"type":"step","event":"line","line":1,"prevLine":null,"stack":[{"id":"m","name":"<module>","kind":"global","line":1,"locals":[{"name":"a","value":{"t":"ref","id":"1","ID":null}}],"returnValue":null}],"heap":{"1":{"kind":"class","name":"SECRET"}},"error":null}`,
			exit)},
		{"hit source cleared by a key that differs in case", wireLines(helloLine,
			`{"type":"exit","kind":"normal","code":0,"signal":null,"message":null,"lineHits":{"1":1},"lineHitsSource":"counter","LineHitsSource":null}`)},
		{"stream without hello", wireLines(`{"type":"log","level":"info","message":"SECRET"}`)},
		{"bytes after exit", append(wireLines(helloLine, exit), write{3, "SECRET"})},
		{"read of an object missing from heap", wireLines(helloLine, readsLine("SECRET", 0), exit)},
		{"read past the end of a sequence", wireLines(helloLine, readsLine("1", 1), exit)},
		{"read of an object that is not a sequence", wireLines(helloLine, readsLine("2", 0), exit)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := record(t, config(t, 1000, tracecore.DefaultLimits), tracecore.Outcome{}, tc.writes)
			if !errors.Is(err, tracecore.ErrMalformed) {
				t.Fatalf("err = %v, want ErrMalformed", err)
			}
			if strings.Contains(err.Error(), "SECRET") {
				t.Errorf("error quotes the tracer's output: %v", err)
			}
		})
	}
}

func TestLogMessagesMayComeAnywhere(t *testing.T) {
	log := func(msg string) string { return `{"type":"log","level":"debug","message":"` + msg + `"}` }
	res := mustRecord(t, config(t, 1000, tracecore.DefaultLimits), tracecore.Outcome{},
		wireLines(log("before hello"), helloLine, exitLine("normal", 0), log("after exit")))

	var got []string
	for _, l := range res.Logs {
		got = append(got, l.Message)
	}
	if diff := cmp.Diff([]string{"before hello", "after exit"}, got); diff != "" {
		t.Errorf("logs (-want +got):\n%s", diff)
	}
}

func TestRunErrorsThatAreNotTheCoresAreReturned(t *testing.T) {
	errInfra := errors.New("sandbox failed")
	valid := wireLines(helloLine, exitLine("normal", 0))
	tests := []struct {
		name    string
		writes  []write
		stopped bool
		runErr  error
	}{
		{"sandbox failure", valid, false, errInfra},
		{"cancel after the output limit", []write{{1, strings.Repeat("x", 65<<10)}}, true, context.Canceled},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := tracecore.NewRecorder(config(t, 1000, tracecore.DefaultLimits))
			if err := feed(rec, tc.writes); (err != nil) != tc.stopped {
				t.Fatalf("write error = %v, want one: %t", err, tc.stopped)
			}
			if _, err := rec.Finish(tracecore.Outcome{}, tc.runErr); !errors.Is(err, tc.runErr) {
				t.Fatalf("err = %v, want %v", err, tc.runErr)
			}
		})
	}
}

func TestWireLinesSplitAcrossWrites(t *testing.T) {
	raw, err := os.ReadFile("../../schema/testdata/wire/python.ndjson")
	if err != nil {
		t.Fatal(err)
	}
	cfg := config(t, 1000, tracecore.DefaultLimits)
	whole := mustRecord(t, cfg, tracecore.Outcome{}, []write{{3, string(raw)}})
	var bytewise []write
	for _, b := range raw {
		bytewise = append(bytewise, write{3, string([]byte{b})})
	}
	split := mustRecord(t, cfg, tracecore.Outcome{}, bytewise)
	if diff := cmp.Diff(whole.Trace(), split.Trace()); diff != "" {
		t.Errorf("trace (-whole +bytewise):\n%s", diff)
	}
}

func TestChunks(t *testing.T) {
	lines := []string{helloLine}
	for i := range 501 {
		lines = append(lines, stepLine(1+i%9, []trace.Frame{frame("m", "<module>", 1+i%9)}, nil))
	}
	res := mustRecord(t, config(t, 1000, tracecore.DefaultLimits), tracecore.Outcome{}, wireLines(append(lines, exitLine("normal", 0))...))
	chunks, err := res.Chunks()
	if err != nil {
		t.Fatal(err)
	}

	var bounds [][2]int
	for i, c := range chunks {
		bounds = append(bounds, [2]int{c.FromStep, c.ToStep})
		if c.Index != i {
			t.Errorf("chunk %d has index %d", i, c.Index)
		}
		zr, err := gzip.NewReader(bytes.NewReader(c.Gzip))
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(zr)
		if err != nil {
			t.Fatal(err)
		}
		if sum := sha256.Sum256(raw); hex.EncodeToString(sum[:]) != c.SHA256 {
			t.Errorf("chunk %d: sha256 does not match its unzipped JSON", i)
		}
		var got []trace.Step
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		if !got[0].Keyframe {
			t.Errorf("chunk %d starts on step %d, which is not a keyframe", i, got[0].I)
		}
		if diff := cmp.Diff(res.Steps[c.FromStep:c.ToStep+1], got); diff != "" {
			t.Errorf("chunk %d steps (-want +got):\n%s", i, diff)
		}
	}
	if diff := cmp.Diff([][2]int{{0, 249}, {250, 499}, {500, 500}}, bounds); diff != "" {
		t.Errorf("chunk bounds (-want +got):\n%s", diff)
	}
}

func readsLine(obj string, index int) string {
	name := "SECRET"
	locals := []trace.Local{local("a", ref("1")), local("b", ref("2"))}
	heap := map[string]trace.HeapObject{"1": list(intv("1")), "2": {Kind: trace.HeapObjectKindClass, Name: &name}}
	return message("step", wire.Step{Event: trace.EventLine, Line: 1, Stack: []trace.Frame{frame("m", "<module>", 1, locals...)}, Heap: heap,
		Reads: []wire.StepReadsElem{{Obj: obj, Index: index}}})
}
