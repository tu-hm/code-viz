package tracecore_test

import (
	"errors"
	"strconv"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/tracecore"
)

func cellsOf(cells map[string]string) map[string]trace.Value {
	out := map[string]trace.Value{}
	for k, v := range cells {
		out[k] = intv(v)
	}
	return out
}

func sparseSeq(length int, def string, cells map[string]string) trace.HeapObject {
	typ, fixed := "int ["+strconv.Itoa(length)+"]", true
	return trace.HeapObject{Kind: trace.HeapObjectKindSequence, Type: &typ, Length: &length, Fixed: &fixed,
		Sparse: &trace.Sparse{Default: intv(def), Items: cellsOf(cells)}}
}

func windowed(o trace.HeapObject, start, count int) trace.HeapObject {
	truncated := true
	o.Truncated, o.Window = &truncated, &trace.Window{Start: start, Count: count}
	return o
}

func patchSeq(length int, cells map[string]string) trace.HeapObject {
	typ := "int [" + strconv.Itoa(length) + "]"
	return trace.HeapObject{Kind: trace.HeapObjectKindSequence, Type: &typ, Length: &length, Patch: cellsOf(cells)}
}

func arrayStep(line int, objects ...trace.HeapObject) string {
	var locals []trace.Local
	heap := map[string]trace.HeapObject{}
	for i, o := range objects {
		id := strconv.Itoa(i + 1)
		locals = append(locals, local("a"+id, ref(id)))
		heap[id] = o
	}
	return stepLine(line, []trace.Frame{frame("m", "main", line, locals...)}, heap)
}

func recordArrays(t *testing.T, lim tracecore.Limits, steps ...[]trace.HeapObject) *tracecore.Result {
	t.Helper()
	lines := []string{helloLine}
	for i, objects := range steps {
		lines = append(lines, arrayStep(i+1, objects...))
	}
	return mustRecord(t, config(t, 1000, lim), tracecore.Outcome{}, wireLines(append(lines, exitLine("normal", 0))...))
}

func storedArrays(res *tracecore.Result) []*trace.HeapObject {
	var out []*trace.HeapObject
	for _, st := range res.Steps {
		if o, ok := st.Heap["o1"]; ok {
			out = append(out, &o)
		} else {
			out = append(out, nil)
		}
	}
	return out
}

func TestSparsePatchesAreStoredAsChangedCells(t *testing.T) {
	res := recordArrays(t, tracecore.DefaultLimits,
		[]trace.HeapObject{sparseSeq(10, "0", map[string]string{"2": "5"})},
		[]trace.HeapObject{patchSeq(10, map[string]string{"4": "2"})},
		[]trace.HeapObject{patchSeq(10, nil)},
		[]trace.HeapObject{patchSeq(10, map[string]string{"4": "0"})},
		[]trace.HeapObject{patchSeq(10, map[string]string{"2": "5"})},
		[]trace.HeapObject{sparseSeq(10, "0", map[string]string{"2": "5", "7": "1"})},
		[]trace.HeapObject{sparseSeq(10, "3", map[string]string{"2": "5"})},
	)
	first, defaultChanged := sparseSeq(10, "0", map[string]string{"2": "5"}), sparseSeq(10, "3", map[string]string{"2": "5"})
	want := []*trace.HeapObject{
		&first,
		new(patchSeq(10, map[string]string{"4": "2"})),
		nil,
		new(patchSeq(10, map[string]string{"4": "0"})),
		nil,
		new(patchSeq(10, map[string]string{"7": "1"})),
		&defaultChanged,
	}
	if diff := cmp.Diff(want, storedArrays(res)); diff != "" {
		t.Errorf("stored array per step (-want +got):\n%s", diff)
	}
}

func TestSparseKeyframeIsRebuiltFromPatches(t *testing.T) {
	steps := [][]trace.HeapObject{{sparseSeq(100, "0", nil)}}
	all := map[string]string{}
	for i := 1; i <= 50; i++ {
		steps = append(steps, []trace.HeapObject{patchSeq(100, map[string]string{strconv.Itoa(i): "1"})})
		all[strconv.Itoa(i)] = "1"
	}
	res := recordArrays(t, tracecore.DefaultLimits, steps...)

	if !res.Steps[50].Keyframe {
		t.Fatalf("step 50 is not a keyframe")
	}
	if diff := cmp.Diff(sparseSeq(100, "0", all), res.Steps[50].Heap["o1"]); diff != "" {
		t.Errorf("keyframe 50 (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(sparseSeq(100, "0", nil), res.Steps[0].Heap["o1"]); diff != "" {
		t.Errorf("keyframe 0 after later patches (-want +got):\n%s", diff)
	}
}

func TestSparseWireRejects(t *testing.T) {
	retyped := patchSeq(10, map[string]string{"1": "1"})
	other := "long long [10]"
	retyped.Type = &other
	withField := patchSeq(10, map[string]string{"1": "1"})
	withField.Fixed = new(true)
	refCell := sparseSeq(10, "0", nil)
	refCell.Sparse.Items["1"] = ref("1")
	refDefault := sparseSeq(10, "0", nil)
	refDefault.Sparse.Default = ref("1")
	noWindow := sparseSeq(10, "0", nil)
	noWindow.Truncated = new(true)
	onRecord := sparseSeq(10, "0", nil)
	onRecord.Kind, onRecord.Fields = trace.HeapObjectKindRecord, []trace.Field{}

	tests := []struct {
		name    string
		steps   [][]trace.HeapObject
		wantErr bool
	}{
		{"patch on the first step", [][]trace.HeapObject{{patchSeq(10, nil)}}, true},
		{"patch after the sequence missed a step", [][]trace.HeapObject{{sparseSeq(10, "0", nil)}, {}, {patchSeq(10, nil)}}, true},
		{"patch to a dense sequence", [][]trace.HeapObject{{list(intv("1"))}, {patchSeq(1, nil)}}, true},
		{"patch that changes the length", [][]trace.HeapObject{{sparseSeq(10, "0", nil)}, {patchSeq(11, nil)}}, true},
		{"patch that changes the type", [][]trace.HeapObject{{sparseSeq(10, "0", nil)}, {retyped}}, true},
		{"patch with another field", [][]trace.HeapObject{{sparseSeq(10, "0", nil)}, {withField}}, true},
		{"patch cell at the length", [][]trace.HeapObject{{sparseSeq(10, "0", nil)}, {patchSeq(10, map[string]string{"10": "1"})}}, true},
		{"patch cell at the last index", [][]trace.HeapObject{{sparseSeq(10, "0", nil)}, {patchSeq(10, map[string]string{"9": "1"})}}, false},
		{"patch cell past the window", [][]trace.HeapObject{{windowed(sparseSeq(10, "0", nil), 0, 5)}, {patchSeq(10, map[string]string{"5": "1"})}}, true},
		{"patch cell at the window's end", [][]trace.HeapObject{{windowed(sparseSeq(10, "0", nil), 0, 5)}, {patchSeq(10, map[string]string{"4": "1"})}}, false},
		{"sparse cell at the length", [][]trace.HeapObject{{sparseSeq(10, "0", map[string]string{"10": "1"})}}, true},
		{"sparse cell that is a ref", [][]trace.HeapObject{{refCell}}, true},
		{"sparse default that is a ref", [][]trace.HeapObject{{refDefault}}, true},
		{"window past the end", [][]trace.HeapObject{{windowed(sparseSeq(10, "0", nil), 8, 3)}}, true},
		{"window up to the end", [][]trace.HeapObject{{windowed(sparseSeq(10, "0", nil), 8, 2)}}, false},
		{"truncated without a window", [][]trace.HeapObject{{noWindow}}, true},
		{"sparse cells on a record", [][]trace.HeapObject{{onRecord}}, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			lines := []string{helloLine}
			for i, objects := range tc.steps {
				lines = append(lines, arrayStep(i+1, objects...))
			}
			_, err := record(t, config(t, 1000, tracecore.DefaultLimits), tracecore.Outcome{}, wireLines(append(lines, exitLine("normal", 0))...))
			if got := errors.Is(err, tracecore.ErrMalformed); got != tc.wantErr {
				t.Errorf("err = %v, want ErrMalformed: %t", err, tc.wantErr)
			}
		})
	}
}

func TestSparseOverTheCellLimitKeepsTheWindow(t *testing.T) {
	lim := tracecore.DefaultLimits
	lim.Cells, lim.Items = 2, 3
	res := recordArrays(t, lim,
		[]trace.HeapObject{sparseSeq(10, "0", map[string]string{"1": "1", "2": "1"})},
		[]trace.HeapObject{patchSeq(10, map[string]string{"5": "1"})},
		[]trace.HeapObject{patchSeq(10, map[string]string{"6": "1"})},
		[]trace.HeapObject{patchSeq(10, map[string]string{"0": "1"})},
		[]trace.HeapObject{patchSeq(10, map[string]string{"0": "0", "5": "0", "6": "0"})},
	)
	complete := sparseSeq(10, "0", map[string]string{"1": "1", "2": "1"})
	cut := windowed(sparseSeq(10, "0", map[string]string{"1": "1", "2": "1"}), 0, 3)
	want := []*trace.HeapObject{&complete, &cut, nil, new(patchSeq(10, map[string]string{"0": "1"})), &complete}
	if diff := cmp.Diff(want, storedArrays(res)); diff != "" {
		t.Errorf("stored array per step (-want +got):\n%s", diff)
	}
}

func TestStepCellLimit(t *testing.T) {
	two := sparseSeq(10, "0", map[string]string{"1": "1", "2": "1"})
	tests := []struct {
		name      string
		limit     int
		truncated bool
	}{
		{"cells up to the limit are kept", 4, false},
		{"cells over the limit end the trace", 3, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			lim := tracecore.DefaultLimits
			lim.StepCells = tc.limit
			res := recordArrays(t, lim, []trace.HeapObject{list()}, []trace.HeapObject{two, two})
			sum := res.Header.Summary
			if tc.truncated && (sum.Truncation == nil || sum.Truncation.Reason != trace.SummaryTruncationReasonSizeLimit || sum.StepCount != 1) {
				t.Errorf("summary = %+v, want size_limit after one step", sum)
			}
			if !tc.truncated && (sum.Truncated || sum.StepCount != 2) {
				t.Errorf("summary = %+v, want two steps and no truncation", sum)
			}
		})
	}
}

func TestSparseLeftOutByTheHeapLimitComesBackWhole(t *testing.T) {
	lim := tracecore.DefaultLimits
	lim.HeapObjects = 1
	arr := func(cells map[string]string) map[string]trace.HeapObject {
		return map[string]trace.HeapObject{"1": sparseSeq(10, "0", cells), "2": list()}
	}
	both := func(line int, first, second string, heap map[string]trace.HeapObject) string {
		return stepLine(line, []trace.Frame{frame("m", "main", line, local("x", ref(first)), local("y", ref(second)))}, heap)
	}
	patched := arr(nil)
	patched["1"] = patchSeq(10, map[string]string{"3": "1"})
	unchanged := arr(nil)
	unchanged["1"] = patchSeq(10, nil)
	res := mustRecord(t, config(t, 1000, lim), tracecore.Outcome{}, wireLines(helloLine,
		both(1, "1", "2", arr(nil)),
		both(2, "2", "1", patched),
		both(3, "1", "2", unchanged),
		exitLine("normal", 0)))

	if _, ok := res.Steps[1].Heap["o1"]; ok {
		t.Errorf("step 1 kept the array past the heap limit")
	}
	if diff := cmp.Diff(sparseSeq(10, "0", map[string]string{"3": "1"}), res.Steps[2].Heap["o1"]); diff != "" {
		t.Errorf("step 2 array (-want +got):\n%s", diff)
	}
}

func TestBigArrayDFSFitsTheSizeTarget(t *testing.T) {
	const n, steps = 200_000, 1000
	var order [][2]int
	stack := [][2]int{{1, 0}}
	for len(order) < steps && len(stack) > 0 {
		u := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		order = append(order, u)
		for _, v := range []int{2*u[0] + 1, 2 * u[0]} {
			if v <= n {
				stack = append(stack, [2]int{v, u[1] + 1})
			}
		}
	}

	lines := []string{helloLine}
	for i := range steps {
		u, d := order[i/2][0], order[i/2][1]
		depth, tin := patchSeq(n+5, nil), patchSeq(n+5, nil)
		switch {
		case i == 0:
			depth, tin = sparseSeq(n+5, "0", nil), sparseSeq(n+5, "0", nil)
		case i%2 == 1:
			depth = patchSeq(n+5, map[string]string{strconv.Itoa(u): strconv.Itoa(d)})
		default:
			tin = patchSeq(n+5, map[string]string{strconv.Itoa(u): strconv.Itoa(i / 2)})
		}
		globals := frame("g", "Globals", 10, local("depth", ref("1")), local("tin", ref("2")), local("timer", intv(strconv.Itoa(i/2))))
		globals.Kind = trace.FrameKindGlobal
		dfs := frame("1", "dfs", 10+i%2, local("u", intv(strconv.Itoa(u))), local("d", intv(strconv.Itoa(d))))
		lines = append(lines, stepLine(10+i%2, []trace.Frame{globals, frame("0", "main", 20), dfs}, map[string]trace.HeapObject{"1": depth, "2": tin}))
	}
	res := mustRecord(t, config(t, steps, tracecore.DefaultLimits), tracecore.Outcome{}, wireLines(append(lines, exitLine("normal", 0))...))

	if sum := res.Header.Summary; sum.Truncated || sum.StepCount != steps {
		t.Fatalf("summary = %+v, want %d steps and no truncation", sum, steps)
	}
	for _, st := range res.Steps[1:] {
		if st.Keyframe {
			continue
		}
		for id, o := range st.Heap {
			if o.Sparse != nil || len(o.Patch) != 1 {
				t.Fatalf("step %d stores %s as %+v, want a one-cell patch", st.I, id, o)
			}
		}
	}
	chunks, err := res.Chunks()
	if err != nil {
		t.Fatal(err)
	}
	size := 0
	for _, c := range chunks {
		size += len(c.Gzip)
	}
	if size > 2<<20 {
		t.Errorf("gzipped chunks = %d bytes, want at most 2 MiB", size)
	}
}
