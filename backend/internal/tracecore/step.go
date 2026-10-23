package tracecore

import (
	"bytes"
	"encoding/json"
	"maps"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/gen/wire"
)

const keyframeInterval = 50 // D2

type snapshotJSON struct {
	frames  map[string][]byte
	heap    map[string][]byte
	objects []string // heap ids in order of first appearance
}

func (r *Recorder) step(s wire.Step) error {
	if r.truncation != nil {
		return nil
	}
	if len(r.steps) == r.cfg.Options.MaxSteps {
		r.truncate(trace.SummaryTruncationReasonStepLimit)
		r.tail = append(append(r.tail, r.stdout...), r.stderr...)
		r.tailStdout += len(r.stdout)
		return nil
	}

	m := mapper{r: r, heap: s.Heap, seen: map[string]string{}}
	frames, err := m.frames(s.Stack)
	if err != nil {
		return err
	}
	heap := map[string]trace.HeapObject{}
	for len(m.queue) > 0 {
		native := m.queue[0]
		m.queue = m.queue[1:]
		obj, err := m.object(s.Heap[native])
		if err != nil {
			return err
		}
		heap[m.seen[native]] = obj
	}

	i := len(r.steps)
	st := trace.Step{
		I:              i,
		Event:          s.Event,
		PrevLine:       trace.StepPrevLine(s.PrevLine),
		Line:           s.Line,
		Keyframe:       i%keyframeInterval == 0,
		Stack:          []string{},
		Frames:         map[string]trace.Frame{},
		Heap:           map[string]trace.HeapObject{},
		RemovedObjects: []string{},
		Stdout:         string(r.stdout),
		Stderr:         string(r.stderr),
		Error:          (*trace.StepError)(s.Error),
		StdinPos:       s.StdinPos,
		CallID:         s.CallID,
		ParentCallID:   s.ParentCallID,
	}
	next := snapshotJSON{frames: map[string][]byte{}, heap: map[string][]byte{}, objects: m.order}
	for _, f := range frames {
		b, err := json.Marshal(f)
		if err != nil {
			return err
		}
		next.frames[f.ID] = b
		st.Stack = append(st.Stack, f.ID)
		if st.Keyframe || !bytes.Equal(b, r.prev.frames[f.ID]) {
			st.Frames[f.ID] = f
		}
	}
	for _, id := range m.order {
		b, err := json.Marshal(heap[id])
		if err != nil {
			return err
		}
		next.heap[id] = b
		if st.Keyframe || !bytes.Equal(b, r.prev.heap[id]) {
			st.Heap[id] = heap[id]
		}
	}
	if !st.Keyframe {
		for _, id := range r.prev.objects {
			if _, ok := next.heap[id]; !ok {
				st.RemovedObjects = append(st.RemovedObjects, id)
			}
		}
	}

	b, err := json.Marshal(st)
	if err != nil {
		return err
	}
	if r.size+len(b) > r.cfg.Limits.TraceBytes {
		r.truncate(trace.SummaryTruncationReasonSizeLimit)
		return errSizeLimit
	}
	r.size += len(b)
	r.steps = append(r.steps, st)
	r.prev = next
	r.stdout, r.stderr = nil, nil
	return nil
}

type mapper struct {
	r     *Recorder
	heap  map[string]trace.HeapObject
	seen  map[string]string // native id => oN, only objects kept in this step
	order []string          // oN in order of first appearance
	queue []string
}

func (m *mapper) frames(stack []trace.Frame) ([]trace.Frame, error) {
	lim := m.r.cfg.Limits
	var outer []trace.Frame
	inner := stack
	if len(inner) > 0 && inner[0].Kind == trace.FrameKindGlobal {
		outer, inner = inner[:1], inner[1:]
	}
	if len(inner) > lim.Frames {
		inner = inner[len(inner)-lim.Frames:]
	}

	var out []trace.Frame
	for _, f := range slices.Concat(outer, inner) {
		id, ok := m.r.frameIDs[f.ID]
		if !ok {
			id = "f" + strconv.Itoa(len(m.r.frameIDs))
			m.r.frameIDs[f.ID] = id
		}
		locals := make([]trace.Local, 0, len(f.Locals))
		for _, l := range f.Locals {
			if l.Internal != nil && *l.Internal && !showInternals(m.r.cfg.Options) {
				continue
			}
			v, err := m.value(l.Value)
			if err != nil {
				return nil, err
			}
			l.Value = v
			locals = append(locals, l)
		}
		f.ID, f.Locals = id, locals
		if f.ReturnValue != nil {
			v, err := m.value(trace.Value(*f.ReturnValue))
			if err != nil {
				return nil, err
			}
			rv := trace.FrameReturnValue(v)
			f.ReturnValue = &rv
		}
		out = append(out, f)
	}
	return out, nil
}

func showInternals(o trace.Options) bool {
	return o.ShowInternals != nil && *o.ShowInternals
}

// required pointers can be nil: encoding/json matches keys case-insensitively, so "ID":null overwrites a validated "id"
func (m *mapper) value(v trace.Value) (trace.Value, error) {
	switch v.T {
	case trace.ValueTRef:
		if v.ID == nil {
			return v, m.r.malformed("ref without id")
		}
		id, kept, err := m.ref(*v.ID)
		if err != nil {
			return v, err
		}
		if !kept {
			reason := "object_limit"
			return trace.Value{T: trace.ValueTUnavailable, Reason: &reason, Type: v.Type}, nil
		}
		v.ID = &id
	case trace.ValueTPtr:
		if v.Target == nil {
			return v, nil
		}
		id, kept, err := m.ref(*v.Target)
		if err != nil {
			return v, err
		}
		v.Target = nil
		if kept {
			v.Target = &id
		}
	case trace.ValueTStr:
		if v.V == nil {
			return v, nil
		}
		n := utf8.RuneCountInString(*v.V)
		if n <= m.r.cfg.Limits.StringChars {
			return v, nil
		}
		cut, truncated := strings.Clone(firstRunes(*v.V, m.r.cfg.Limits.StringChars)), true // clone: a substring pins the whole decoded string
		v.V, v.Truncated = &cut, &truncated
		if v.Len == nil {
			v.Len = &n
		}
	}
	return v, nil
}

func firstRunes(s string, n int) string {
	for i := range s {
		if n == 0 {
			return s[:i]
		}
		n--
	}
	return s
}

// ref returns the trace id of the object a value points to, and whether the object is kept in this step.
func (m *mapper) ref(native string) (string, bool, error) {
	if id, ok := m.seen[native]; ok {
		return id, true, nil
	}
	if _, ok := m.heap[native]; !ok {
		return "", false, m.r.malformed("reference to an object missing from heap")
	}
	if len(m.seen) == m.r.cfg.Limits.HeapObjects {
		return "", false, nil
	}
	id, ok := m.r.objectIDs[native]
	if !ok {
		id = "o" + strconv.Itoa(len(m.r.objectIDs)+1)
		m.r.objectIDs[native] = id
	}
	m.seen[native] = id
	m.order = append(m.order, id)
	m.queue = append(m.queue, native)
	return id, true, nil
}

func (m *mapper) object(o trace.HeapObject) (trace.HeapObject, error) {
	lim, truncated := m.r.cfg.Limits.Items, true
	// clone: a cut slice pins every decoded item
	if len(o.Items) > lim {
		o.Items, o.Truncated = slices.Clone(o.Items[:lim]), &truncated
	}
	if len(o.Entries) > lim {
		o.Entries, o.Truncated = slices.Clone(o.Entries[:lim]), &truncated
	}

	var err error
	for i := range o.Items {
		if o.Items[i], err = m.value(o.Items[i]); err != nil {
			return o, err
		}
	}
	for i := range o.Entries {
		if o.Entries[i].Key, err = m.value(o.Entries[i].Key); err != nil {
			return o, err
		}
		if o.Entries[i].Value, err = m.value(o.Entries[i].Value); err != nil {
			return o, err
		}
	}
	for i := range o.Fields {
		if o.Fields[i].Value, err = m.value(o.Fields[i].Value); err != nil {
			return o, err
		}
	}
	if o.Sparse != nil {
		if o.Sparse.Default, err = m.value(o.Sparse.Default); err != nil {
			return o, err
		}
		if err := m.cells(o.Sparse.Items); err != nil {
			return o, err
		}
	}
	return o, m.cells(o.Patch)
}

func (m *mapper) cells(cells map[string]trace.Value) error {
	for _, k := range slices.Sorted(maps.Keys(cells)) {
		v, err := m.value(cells[k])
		if err != nil {
			return err
		}
		cells[k] = v
	}
	return nil
}
