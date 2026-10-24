package tracecore

import (
	"maps"
	"strconv"

	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
)

// seq is a sparse sequence as the tracer's last step message left it (§19.9.1).
type seq struct {
	head    trace.HeapObject       // the object without its cells; head.Sparse holds the default
	cells   map[string]trace.Value // non-default cells; patches change it in place, so stored steps get clones
	changed map[string]trace.Value // cells this message changed; nil when the last message had no such sequence
}

// inflate applies a step message's sparse sequences and patches to the sequences of the message before it.
func (r *Recorder) inflate(heap map[string]trace.HeapObject) error {
	next := map[string]*seq{}
	cells := 0
	for native, o := range heap {
		if o.Sparse == nil && o.Patch == nil {
			continue
		}
		if o.Kind != trace.HeapObjectKindSequence || o.Type == nil || o.Length == nil {
			return r.malformed("sparse cells outside a sequence with type and length")
		}
		var s *seq
		var err error
		if o.Patch != nil {
			s, err = r.patched(r.seqs[native], o)
		} else {
			s, err = r.sparse(r.seqs[native], o)
		}
		if err != nil {
			return err
		}
		cells += len(s.cells)
		if cells > r.cfg.Limits.StepCells {
			r.truncate(trace.SummaryTruncationReasonSizeLimit)
			return errSizeLimit
		}
		next[native] = s
	}
	r.seqs = next
	return nil
}

func (r *Recorder) sparse(prev *seq, o trace.HeapObject) (*seq, error) {
	if o.Items != nil || !scalar(o.Sparse.Default) {
		return nil, r.malformed("sparse sequence with items or a default that is not a scalar")
	}
	if o.Truncated != nil && *o.Truncated && o.Window == nil {
		return nil, r.malformed("truncated sparse sequence without a window")
	}
	if err := r.checkCells(o, o.Sparse.Items); err != nil {
		return nil, err
	}
	s := &seq{head: o, cells: map[string]trace.Value{}}
	s.head.Sparse = &trace.Sparse{Default: o.Sparse.Default}
	for k, v := range o.Sparse.Items {
		if !same(v, o.Sparse.Default) {
			s.cells[k] = v
		}
	}
	if prev == nil {
		return s, nil
	}
	s.changed = map[string]trace.Value{}
	for k := range prev.cells {
		if _, ok := s.cells[k]; !ok {
			s.changed[k] = o.Sparse.Default
		}
	}
	for k, v := range s.cells {
		if old, ok := prev.cells[k]; !ok || !same(old, v) {
			s.changed[k] = v
		}
	}
	return s, nil
}

func (r *Recorder) patched(prev *seq, o trace.HeapObject) (*seq, error) {
	if prev == nil {
		return nil, r.malformed("patch for a sequence that was not sparse in the previous step")
	}
	// a patch carries cells only; everything else stays as the previous step sent it
	if *o.Type != *prev.head.Type || *o.Length != *prev.head.Length || o.Sparse != nil || o.Items != nil ||
		o.Entries != nil || o.Fields != nil || o.Fixed != nil || o.Meta != nil || o.Name != nil || o.Ordered != nil ||
		o.Signature != nil || o.Summary != nil || o.Truncated != nil || o.Window != nil {
		return nil, r.malformed("patch that changes more than cells")
	}
	if err := r.checkCells(prev.head, o.Patch); err != nil {
		return nil, err
	}
	def := prev.head.Sparse.Default
	prev.changed = map[string]trace.Value{}
	for k, v := range o.Patch {
		old, ok := prev.cells[k]
		if !ok {
			old = def
		}
		if same(old, v) {
			continue
		}
		prev.changed[k] = v
		if same(v, def) {
			delete(prev.cells, k)
		} else {
			prev.cells[k] = v
		}
	}
	return prev, nil
}

func (r *Recorder) checkCells(head trace.HeapObject, cells map[string]trace.Value) error {
	lo, hi := 0, *head.Length
	if w := head.Window; w != nil {
		if w.Start > hi || w.Count > hi-w.Start {
			return r.malformed("window past the end of the sequence")
		}
		lo, hi = w.Start, w.Start+w.Count
	}
	for k, v := range cells {
		i, err := strconv.Atoi(k)
		if err != nil || i < lo || i >= hi {
			return r.malformed("sparse cell outside the sequence or its window")
		}
		if !scalar(v) {
			return r.malformed("sparse cell that is not a scalar")
		}
	}
	return nil
}

// view is the stored form: every non-default cell up to Limits.Cells, else only the cells in the first Limits.Items (§19.9.1).
func (s *seq) view(lim Limits) trace.HeapObject {
	o := s.head
	o.Sparse = &trace.Sparse{Default: s.head.Sparse.Default, Items: s.cells}
	if len(s.cells) <= lim.Cells {
		return o
	}
	w := trace.Window{Count: *o.Length}
	if o.Window != nil {
		w = *o.Window
	}
	w.Count = min(w.Count, lim.Items)
	truncated := true
	o.Truncated, o.Window = &truncated, &w
	o.Sparse = &trace.Sparse{Default: s.head.Sparse.Default, Items: inside(s.cells, w)}
	return o
}

// patch is the delta for a step whose view kept the previous step's header.
func (s *seq) patch(view trace.HeapObject) map[string]trace.Value {
	if view.Window == nil {
		return s.changed
	}
	return inside(s.changed, *view.Window)
}

func inside(cells map[string]trace.Value, w trace.Window) map[string]trace.Value {
	out := map[string]trace.Value{}
	for k, v := range cells {
		if i, err := strconv.Atoi(k); err == nil && i >= w.Start && i-w.Start < w.Count {
			out[k] = v
		}
	}
	return out
}

func scalar(v trace.Value) bool {
	switch v.T {
	case trace.ValueTInt, trace.ValueTFloat, trace.ValueTBool, trace.ValueTChar:
		return v.V != nil
	}
	return false
}

func same(a, b trace.Value) bool {
	return a.T == b.T && *a.V == *b.V
}

// header is the part of a stored object compared between steps: a sparse sequence without its cells.
func header(o trace.HeapObject) trace.HeapObject {
	if o.Sparse != nil {
		o.Sparse = &trace.Sparse{Default: o.Sparse.Default}
	}
	return o
}

// owned clones the cells a stored step keeps, since inflate changes them in place.
func owned(o trace.HeapObject) trace.HeapObject {
	if o.Sparse != nil {
		o.Sparse = &trace.Sparse{Default: o.Sparse.Default, Items: maps.Clone(o.Sparse.Items)}
	}
	return o
}
