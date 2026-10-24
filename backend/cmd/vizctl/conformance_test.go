package main

import (
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
)

type port struct {
	Exit       string
	Tail       string
	CallDepths []int
	Returns    int
	ErrorDepth *int
	Aliases    []string
	Kinds      map[string][]string
}

func TestPortsAgreeAcrossLanguages(t *testing.T) {
	t.Chdir("../..")
	paths, err := filepath.Glob(manifests)
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string][]string{}
	for _, path := range paths {
		lang := filepath.Base(filepath.Dir(path))
		goldens, err := filepath.Glob(filepath.Join("fixtures", lang, "*", "expected.trace.json"))
		if err != nil {
			t.Fatal(err)
		}
		for _, golden := range goldens {
			name := filepath.Base(filepath.Dir(golden))
			cases[name] = append(cases[name], golden)
		}
	}

	for _, name := range slices.Sorted(maps.Keys(cases)) {
		goldens := cases[name]
		if len(goldens) < 2 {
			continue
		}
		t.Run(name, func(t *testing.T) {
			first := portOf(t, goldens[0])
			for _, golden := range goldens[1:] {
				want, got := first, portOf(t, golden)
				want.Kinds, got.Kinds = common(first.Kinds, got.Kinds), common(got.Kinds, first.Kinds)
				if len(got.Kinds) == 0 {
					t.Errorf("%s and %s have no variable name in common", goldens[0], golden)
				}
				if diff := cmp.Diff(want, got); diff != "" {
					t.Errorf("%s vs %s (-first +second):\n%s", goldens[0], golden, diff)
				}
			}
		})
	}
}

func portOf(t *testing.T, golden string) port {
	t.Helper()
	raw, err := os.ReadFile(golden)
	if err != nil {
		t.Fatal(err)
	}
	var tr trace.Trace
	if err := json.Unmarshal(raw, &tr); err != nil {
		t.Fatal(err)
	}

	p := port{Exit: outcome(tr.Summary.Exit.Kind), Kinds: map[string][]string{}}
	if tail := tr.Summary.UntracedTail; tail != nil {
		p.Tail = outcome(tail.Exit.Kind)
	}

	depth := map[int]int{}
	var depths []int
	returns := 0
	frames := map[string]trace.Frame{}
	heap := map[string]trace.HeapObject{}
	kinds := map[string]map[string]bool{}
	aliases := map[string]bool{}
	for _, st := range tr.Steps {
		if st.Keyframe {
			frames, heap = maps.Clone(st.Frames), maps.Clone(st.Heap)
		} else {
			maps.Copy(frames, st.Frames)
			for id, o := range st.Heap {
				if o.Patch != nil {
					o = patched(heap[id], o.Patch)
				}
				heap[id] = o
			}
			for _, id := range st.RemovedObjects {
				delete(heap, id)
			}
		}

		switch st.Event {
		case trace.EventCall:
			d := 0
			if st.ParentCallID != nil {
				d = depth[*st.ParentCallID] + 1
			}
			depth[*st.CallID] = d
			depths = append(depths, d)
		case trace.EventReturn:
			returns++
		}

		names := map[string][]string{}
		for _, id := range st.Stack {
			for _, l := range frames[id].Locals {
				if (l.Internal != nil && *l.Internal) || l.Value.T == trace.ValueTUninit {
					continue
				}
				if kinds[l.Name] == nil {
					kinds[l.Name] = map[string]bool{}
				}
				for _, k := range describe(l.Value, heap) {
					kinds[l.Name][k] = true
				}
				if l.Value.T == trace.ValueTRef && !slices.Contains(names[*l.Value.ID], l.Name) {
					names[*l.Value.ID] = append(names[*l.Value.ID], l.Name)
				}
			}
		}
		for _, group := range names {
			if len(group) > 1 {
				slices.Sort(group)
				aliases[strings.Join(group, "=")] = true
			}
		}
	}

	if !tr.Summary.Truncated {
		p.CallDepths, p.Returns = depths, returns
	}
	if last := tr.Steps[len(tr.Steps)-1]; last.Error != nil {
		d := len(last.Stack) - len(tr.Steps[0].Stack)
		p.ErrorDepth = &d
	}
	p.Aliases = slices.Sorted(maps.Keys(aliases))
	for name, set := range kinds {
		p.Kinds[name] = slices.Sorted(maps.Keys(set))
	}
	return p
}

func patched(base trace.HeapObject, patch map[string]trace.Value) trace.HeapObject {
	sparse := *base.Sparse
	sparse.Items = maps.Clone(sparse.Items)
	for k, v := range patch {
		if cmp.Equal(v, sparse.Default) {
			delete(sparse.Items, k)
			continue
		}
		sparse.Items[k] = v
	}
	base.Sparse = &sparse
	return base
}

func outcome(kind trace.ExitKind) string {
	if kind == trace.ExitKindSignal {
		return string(trace.ExitKindException)
	}
	return string(kind)
}

func describe(v trace.Value, heap map[string]trace.HeapObject) []string {
	if v.T != trace.ValueTRef {
		return []string{string(v.T)}
	}
	o := heap[*v.ID]
	kind := string(o.Kind)
	items := slices.Clone(o.Items)
	if o.Sparse != nil {
		items = append(items, o.Sparse.Default)
		items = slices.AppendSeq(items, maps.Values(o.Sparse.Items))
	}

	out := []string{kind}
	for _, item := range items {
		out = append(out, kind+">"+kindOf(item, heap))
	}
	for _, e := range o.Entries {
		out = append(out, kind+">"+kindOf(e.Key, heap)+":"+kindOf(e.Value, heap))
	}
	return out
}

func kindOf(v trace.Value, heap map[string]trace.HeapObject) string {
	if v.T == trace.ValueTRef {
		return string(heap[*v.ID].Kind)
	}
	return string(v.T)
}

func common(a, b map[string][]string) map[string][]string {
	out := map[string][]string{}
	for name, kinds := range a {
		if _, ok := b[name]; ok {
			out[name] = kinds
		}
	}
	return out
}
