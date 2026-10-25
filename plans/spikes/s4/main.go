// Command s4 measures trace size for spike S4 (§18.7). It records each wire session with the real tracecore
// recorder, then re-encodes the same steps with other keyframe intervals, chunk sizes and cell patches.
//
//	go run . [-items 1000] [-trace-bytes 20971520] session.ndjson...
package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"time"

	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/tracecore"
	"github.com/tu-hm/code-viz/backend/schema"
)

type state struct {
	stack     []string
	frames    map[string]trace.Frame // every frame seen so far
	frameJSON map[string][]byte
	heap      map[string]trace.HeapObject
	heapJSON  map[string][]byte
	order     []string // heap ids in the recorder's order: frames first, then breadth first
}

type patcher func(prev, cur trace.HeapObject) (trace.HeapObject, bool)

func main() {
	items := flag.Int("items", tracecore.DefaultLimits.Items, "items kept per container (§11 default 1,000, ceiling 10,000)")
	traceBytes := flag.Int("trace-bytes", tracecore.DefaultLimits.TraceBytes, "uncompressed trace budget (§11 default 20 MB)")
	flag.Parse()

	lim := tracecore.DefaultLimits
	lim.Items, lim.TraceBytes = *items, *traceBytes
	for _, path := range flag.Args() {
		if err := measure(path, lim); err != nil {
			log.Fatalf("%s: %v", path, err)
		}
	}
}

func measure(path string, lim tracecore.Limits) error {
	start := time.Now()
	res, wireBytes, err := record(path, lim)
	if err != nil {
		return err
	}
	took := time.Since(start)
	chunks, err := res.Chunks()
	if err != nil {
		return err
	}
	coreGz, coreMax := 0, 0
	for _, c := range chunks {
		coreGz += len(c.Gzip)
		coreMax = max(coreMax, len(c.Gzip))
	}

	states := materialize(res.Steps)
	maxObjects := 0
	for _, st := range states {
		maxObjects = max(maxObjects, len(st.heap))
	}
	trunc := "none"
	if t := res.Header.Summary.Truncation; t != nil {
		trunc = string(t.Reason)
	}
	fmt.Printf("\n%s: wire %.1f MB recorded in %.1f s, %d steps, truncation %s, up to %d objects per step\n",
		filepath.Base(path), mb(wireBytes), took.Seconds(), len(res.Steps), trunc, maxObjects)

	same := encode(res.Steps, states, 50, nil)
	for i := range res.Steps {
		if !bytes.Equal(same[i], mustJSON(res.Steps[i])) {
			return fmt.Errorf("re-encoding with keyframe 50 differs from the recorder at step %d", i)
		}
	}
	fmt.Printf("| %-12s | %3s | %3s | %8s | %8s | %9s |\n", "deltas", "K", "C", "raw MB", "gzip KB", "max chunk")
	fmt.Printf("| %-12s | %3d | %3d | %8.2f | %8.0f | %6.0f KB |\n", "core", 50, 250, mb(size(same)), kb(coreGz), kb(coreMax))

	patchers := []struct {
		name  string
		patch patcher
	}{
		{"whole object", nil},
		{"sparse patch", patchSparse},
		{"any patch", patchAny},
	}
	for _, p := range patchers {
		if err := verify(encode(res.Steps, states, 50, p.patch), states); err != nil {
			return fmt.Errorf("%s: %w", p.name, err)
		}
		for _, k := range []int{25, 50, 100} {
			steps := encode(res.Steps, states, k, p.patch)
			for _, c := range []int{100, 250, 500} {
				if c%k != 0 {
					continue
				}
				gz, most := gzipChunks(steps, c)
				fmt.Printf("| %-12s | %3d | %3d | %8.2f | %8.0f | %6.0f KB |\n", p.name, k, c, mb(size(steps)), kb(gz), kb(most))
			}
		}
	}
	return nil
}

func record(path string, lim tracecore.Limits) (*tracecore.Result, int, error) {
	val, err := schema.New()
	if err != nil {
		return nil, 0, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, err
	}
	defer f.Close()

	rec := tracecore.NewRecorder(tracecore.Config{
		ID:       "trc_s4",
		Source:   trace.Source{File: "main.cpp", LineCount: 40},
		Options:  trace.Options{MaxSteps: 1000, StartAtLines: []int{}},
		Limits:   lim,
		Validate: val.Wire,
	})
	n, err := io.Copy(rec.Wire(), f)
	res, err := rec.Finish(tracecore.Outcome{}, err)
	return res, int(n), err
}

func materialize(steps []trace.Step) []state {
	cur := state{frames: map[string]trace.Frame{}, frameJSON: map[string][]byte{}}
	var states []state
	for _, s := range steps {
		next := state{
			stack:     s.Stack,
			frames:    maps.Clone(cur.frames),
			frameJSON: maps.Clone(cur.frameJSON),
			heap:      maps.Clone(cur.heap),
			heapJSON:  maps.Clone(cur.heapJSON),
		}
		if s.Keyframe {
			next.heap, next.heapJSON = map[string]trace.HeapObject{}, map[string][]byte{}
		}
		for id, f := range s.Frames {
			next.frames[id], next.frameJSON[id] = f, mustJSON(f)
		}
		for id, o := range s.Heap {
			next.heap[id], next.heapJSON[id] = o, mustJSON(o)
		}
		for _, id := range s.RemovedObjects {
			delete(next.heap, id)
			delete(next.heapJSON, id)
		}
		next.order = order(next)
		if len(next.order) != len(next.heap) {
			log.Fatalf("step %d: %d objects reachable, %d in the heap", s.I, len(next.order), len(next.heap))
		}
		states = append(states, next)
		cur = next
	}
	return states
}

func order(st state) []string {
	var ids, queue []string
	seen := map[string]bool{}
	visit := func(v trace.Value) {
		id := v.ID
		if v.T == trace.ValueTPtr {
			id = v.Target
		}
		if id == nil || seen[*id] {
			return
		}
		seen[*id] = true
		ids = append(ids, *id)
		queue = append(queue, *id)
	}
	cells := func(c map[string]trace.Value) {
		for _, k := range slices.Sorted(maps.Keys(c)) {
			visit(c[k])
		}
	}

	for _, fid := range st.stack {
		f := st.frames[fid]
		for _, l := range f.Locals {
			visit(l.Value)
		}
		if f.ReturnValue != nil {
			visit(trace.Value(*f.ReturnValue))
		}
	}
	for len(queue) > 0 {
		o := st.heap[queue[0]]
		queue = queue[1:]
		for _, v := range o.Items {
			visit(v)
		}
		for _, e := range o.Entries {
			visit(e.Key)
			visit(e.Value)
		}
		for _, f := range o.Fields {
			visit(f.Value)
		}
		if o.Sparse != nil {
			visit(o.Sparse.Default)
			cells(o.Sparse.Items)
		}
		cells(o.Patch)
	}
	return ids
}

// encode mirrors the recorder's delta rule with keyframe interval k; patch, when set, may shrink a changed object.
func encode(steps []trace.Step, states []state, k int, patch patcher) [][]byte {
	out := make([][]byte, len(steps))
	for i, st := range states {
		s := steps[i]
		s.Keyframe = i%k == 0
		s.Frames, s.Heap, s.RemovedObjects = map[string]trace.Frame{}, map[string]trace.HeapObject{}, []string{}

		var prev state
		if i > 0 {
			prev = states[i-1]
		}
		for _, fid := range st.stack {
			if s.Keyframe || !slices.Contains(prev.stack, fid) || !bytes.Equal(st.frameJSON[fid], prev.frameJSON[fid]) {
				s.Frames[fid] = st.frames[fid]
			}
		}
		for _, id := range st.order {
			old, had := prev.heapJSON[id]
			if s.Keyframe || !had || !bytes.Equal(st.heapJSON[id], old) {
				s.Heap[id] = st.heap[id]
				if !s.Keyframe && had && patch != nil {
					s.Heap[id], _ = patch(prev.heap[id], st.heap[id])
				}
			}
		}
		if !s.Keyframe {
			for _, id := range prev.order {
				if _, ok := st.heap[id]; !ok {
					s.RemovedObjects = append(s.RemovedObjects, id)
				}
			}
		}
		out[i] = mustJSON(s)
	}
	return out
}

func patchSparse(prev, cur trace.HeapObject) (trace.HeapObject, bool) {
	if prev.Sparse == nil || cur.Sparse == nil || !sameShape(prev, cur) {
		return cur, false
	}
	p := map[string]trace.Value{}
	for k, v := range cur.Sparse.Items {
		if old, ok := prev.Sparse.Items[k]; !ok || !bytes.Equal(mustJSON(old), mustJSON(v)) {
			p[k] = v
		}
	}
	for k := range prev.Sparse.Items {
		if _, ok := cur.Sparse.Items[k]; !ok {
			p[k] = cur.Sparse.Default
		}
	}
	return patched(cur, p), true
}

func patchAny(prev, cur trace.HeapObject) (trace.HeapObject, bool) {
	if o, ok := patchSparse(prev, cur); ok {
		return o, true
	}
	if cur.Kind != trace.HeapObjectKindSequence || cur.Items == nil || len(prev.Items) != len(cur.Items) || !sameShape(prev, cur) {
		return cur, false
	}
	p := map[string]trace.Value{}
	for i := range cur.Items {
		if !bytes.Equal(mustJSON(prev.Items[i]), mustJSON(cur.Items[i])) {
			p[strconv.Itoa(i)] = cur.Items[i]
		}
	}
	return patched(cur, p), true
}

func patched(o trace.HeapObject, p map[string]trace.Value) trace.HeapObject {
	return trace.HeapObject{Kind: o.Kind, Type: o.Type, Length: o.Length, Fixed: o.Fixed, Window: o.Window, Patch: p}
}

func sameShape(a, b trace.HeapObject) bool {
	return bytes.Equal(mustJSON(shape(a)), mustJSON(shape(b)))
}

func shape(o trace.HeapObject) trace.HeapObject {
	o.Items = nil
	if o.Sparse != nil {
		o.Sparse = &trace.Sparse{Default: o.Sparse.Default}
	}
	return o
}

// verify replays keyframes, deltas and patches, and checks every step against the full state.
func verify(encoded [][]byte, states []state) error {
	heap := map[string]trace.HeapObject{}
	for i, raw := range encoded {
		var s trace.Step
		if err := json.Unmarshal(raw, &s); err != nil {
			return err
		}
		if s.Keyframe {
			heap = map[string]trace.HeapObject{}
		}
		for id, o := range s.Heap {
			if o.Patch == nil {
				heap[id] = o
				continue
			}
			base := clone(heap[id])
			for k, v := range o.Patch {
				switch {
				case base.Sparse == nil:
					n, _ := strconv.Atoi(k)
					base.Items[n] = v
				case bytes.Equal(mustJSON(v), mustJSON(base.Sparse.Default)):
					delete(base.Sparse.Items, k)
				default:
					base.Sparse.Items[k] = v
				}
			}
			heap[id] = base
		}
		for _, id := range s.RemovedObjects {
			delete(heap, id)
		}
		if !bytes.Equal(mustJSON(heap), mustJSON(states[i].heap)) {
			return fmt.Errorf("step %d replays to a different heap", i)
		}
	}
	return nil
}

func clone(o trace.HeapObject) trace.HeapObject {
	o.Items = slices.Clone(o.Items)
	if o.Sparse != nil {
		s := *o.Sparse
		s.Items = maps.Clone(s.Items)
		o.Sparse = &s
	}
	return o
}

func gzipChunks(steps [][]byte, size int) (total, most int) {
	for from := 0; from < len(steps); from += size {
		var buf bytes.Buffer
		zw := gzip.NewWriter(&buf)
		zw.Write([]byte("["))
		zw.Write(bytes.Join(steps[from:min(from+size, len(steps))], []byte(",")))
		zw.Write([]byte("]"))
		zw.Close()
		total += buf.Len()
		most = max(most, buf.Len())
	}
	return total, most
}

func size(steps [][]byte) int {
	n := 0
	for _, s := range steps {
		n += len(s)
	}
	return n
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		log.Fatal(err)
	}
	return b
}

func mb(n int) float64 { return float64(n) / (1 << 20) }

func kb(n int) float64 { return float64(n) / (1 << 10) }
