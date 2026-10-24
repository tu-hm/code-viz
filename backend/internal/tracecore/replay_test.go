package tracecore_test

import (
	"encoding/json"
	"maps"
	"math/rand/v2"
	"slices"
	"strconv"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/tracecore"
)

type snapshot struct {
	stack []trace.Frame
	heap  map[string]trace.HeapObject
}

func TestDeltasReplayToFullSteps(t *testing.T) {
	seed := rand.Uint64()
	t.Logf("seed %d", seed)
	r := rand.New(rand.NewPCG(seed, seed))

	for run := range 30 {
		snaps := randomRun(r, 130)
		lines := []string{helloLine}
		for i, s := range snaps {
			heap := maps.Clone(s.heap)
			for id, o := range heap {
				if i == 0 || o.Sparse == nil || r.IntN(2) == 0 {
					continue
				}
				if prev, ok := snaps[i-1].heap[id]; ok {
					heap[id] = patchSeq(*o.Length, cellDiff(prev.Sparse.Items, o.Sparse.Items))
				}
			}
			lines = append(lines, stepLine(i+1, s.stack, heap))
		}
		res := mustRecord(t, config(t, 1000, tracecore.DefaultLimits), tracecore.Outcome{}, wireLines(append(lines, exitLine("normal", 0))...))

		var frames map[string]trace.Frame
		var heap map[string]trace.HeapObject
		for i, st := range res.Steps {
			if st.Keyframe {
				frames, heap = maps.Clone(st.Frames), maps.Clone(st.Heap)
			} else {
				maps.Copy(frames, st.Frames)
				for id, o := range st.Heap {
					if o.Patch != nil {
						o = applyPatch(t, heap[id], o.Patch)
					}
					heap[id] = o
				}
				for _, id := range st.RemovedObjects {
					delete(heap, id)
				}
			}
			var stack []trace.Frame
			for _, id := range st.Stack {
				stack = append(stack, frames[id])
			}

			want, _ := canonical(t, snaps[i])
			got, reached := canonical(t, snapshot{stack, heap})
			if diff := cmp.Diff(want, got); diff != "" {
				t.Fatalf("seed %d, run %d, step %d (-full +replayed):\n%s", seed, run, i, diff)
			}
			if reached != len(heap) {
				t.Fatalf("seed %d, run %d, step %d: replayed heap has %d objects, %d reachable", seed, run, i, len(heap), reached)
			}
		}
	}
}

func cellDiff(old, cur map[string]trace.Value) map[string]string {
	out := map[string]string{}
	for k := range old {
		if _, ok := cur[k]; !ok {
			out[k] = "0"
		}
	}
	for k, v := range cur {
		if o, ok := old[k]; !ok || *o.V != *v.V {
			out[k] = *v.V
		}
	}
	return out
}

func applyPatch(t *testing.T, base trace.HeapObject, patch map[string]trace.Value) trace.HeapObject {
	t.Helper()
	if base.Sparse == nil {
		t.Fatalf("patch for an object with no sparse base")
	}
	items := maps.Clone(base.Sparse.Items)
	for k, v := range patch {
		if *v.V == *base.Sparse.Default.V {
			delete(items, k)
		} else {
			items[k] = v
		}
	}
	base.Sparse = &trace.Sparse{Default: base.Sparse.Default, Items: items}
	return base
}

func canonical(t *testing.T, s snapshot) (string, int) {
	t.Helper()
	order := map[string]string{}
	var queue []string
	visit := func(v trace.Value) trace.Value {
		var id *string
		switch v.T {
		case trace.ValueTRef:
			id = v.ID
		case trace.ValueTPtr:
			id = v.Target
		}
		if id == nil {
			return v
		}
		n, ok := order[*id]
		if !ok {
			n = "#" + strconv.Itoa(len(order))
			order[*id] = n
			queue = append(queue, *id)
		}
		if v.T == trace.ValueTRef {
			v.ID = &n
		} else {
			v.Target = &n
		}
		return v
	}

	var frames []trace.Frame
	for _, f := range s.stack {
		f.ID = ""
		locals := make([]trace.Local, len(f.Locals))
		for i, l := range f.Locals {
			l.Value = visit(l.Value)
			locals[i] = l
		}
		f.Locals = locals
		frames = append(frames, f)
	}
	var objects []trace.HeapObject
	for len(queue) > 0 {
		o := s.heap[queue[0]]
		queue = queue[1:]
		items := make([]trace.Value, len(o.Items))
		for i, v := range o.Items {
			items[i] = visit(v)
		}
		o.Items = items
		objects = append(objects, o)
	}

	b, err := json.MarshalIndent(map[string]any{"frames": frames, "objects": objects}, "", " ")
	if err != nil {
		t.Fatal(err)
	}
	return string(b), len(order)
}

func randomRun(r *rand.Rand, steps int) []snapshot {
	type obj struct {
		items []trace.Value
		cells map[string]string
	}
	objects := map[string]*obj{}
	nextObj, nextFrame := 0, 0
	newObject := func() string {
		nextObj++
		id := strconv.Itoa(1000 + nextObj)
		objects[id] = &obj{}
		if r.IntN(4) == 0 {
			objects[id].cells = map[string]string{}
		}
		return id
	}
	pickObject := func() string {
		if len(objects) == 0 || r.IntN(3) == 0 {
			return newObject()
		}
		ids := slices.Sorted(maps.Keys(objects))
		return ids[r.IntN(len(ids))]
	}
	randomValue := func() trace.Value {
		switch r.IntN(4) {
		case 0:
			return ref(pickObject())
		case 1:
			return ptr("0x"+strconv.FormatInt(int64(r.IntN(1<<20)), 16), pickObject())
		case 2:
			return str(strconv.Itoa(r.IntN(5)))
		}
		return intv(strconv.Itoa(r.IntN(5)))
	}
	newFrame := func(kind trace.FrameKind) trace.Frame {
		nextFrame++
		return trace.Frame{ID: "w" + strconv.Itoa(nextFrame), Name: "fn", Kind: kind, Line: 1, Locals: []trace.Local{}}
	}

	stack := []trace.Frame{newFrame(trace.FrameKindGlobal)}
	var out []snapshot
	for range steps {
		top := &stack[len(stack)-1]
		switch r.IntN(7) {
		case 0:
			if len(stack) < 6 {
				stack = append(stack, newFrame(trace.FrameKindFunction))
			}
		case 1:
			if len(stack) > 1 {
				stack = stack[:len(stack)-1]
			}
		case 2:
			top.Locals = append(top.Locals, local("v"+strconv.Itoa(len(top.Locals)), randomValue()))
		case 3:
			if len(top.Locals) > 0 {
				top.Locals[r.IntN(len(top.Locals))].Value = randomValue()
			}
		case 4:
			if len(top.Locals) > 0 {
				top.Locals = top.Locals[:len(top.Locals)-1]
			}
		case 5:
			o := objects[pickObject()]
			k, v := strconv.Itoa(r.IntN(100)), strconv.Itoa(r.IntN(3))
			switch {
			case o.cells == nil:
				o.items = append(o.items, randomValue())
			case v == "0":
				delete(o.cells, k)
			default:
				o.cells[k] = v
			}
		case 6:
			stack[r.IntN(len(stack))].Line = 1 + r.IntN(9)
		}

		snap := snapshot{heap: map[string]trace.HeapObject{}}
		for _, f := range stack {
			f.Locals = append([]trace.Local{}, f.Locals...)
			snap.stack = append(snap.stack, f)
		}
		for id, o := range objects {
			snap.heap[id] = list(append([]trace.Value{}, o.items...)...)
			if o.cells != nil {
				snap.heap[id] = sparseSeq(100, "0", maps.Clone(o.cells))
			}
		}
		out = append(out, snap)
	}
	return out
}
