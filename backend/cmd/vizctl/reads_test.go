package main

import (
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
)

func TestReadsNameTheCellsALineRead(t *testing.T) {
	t.Chdir("../..")
	knapsack := []string{"dp[0]", "dp[1]", "dp[2]", "dp[3]", "dp[4]", "dp[5]", "w[0]", "w[1]"}
	grid := []string{"grid[0]", "grid[0][2]", "grid[1]", "grid[1][2]"}
	tests := []struct {
		name    string
		fixture string
		line    string
		want    []string
	}{
		{"cpp: an index made with xor and shift", "cpp/reads", "t[p ^ 1]", []string{"t[2]", "t[4]"}},
		{"python: an index made with xor and shift", "python/reads", "t[p ^ 1]", []string{"t[2]", "t[4]"}},
		{"cpp: a knapsack reads the cell one weight back", "cpp/reads", "dp[c - w[i]]", knapsack},
		{"python: a knapsack reads the cell one weight back", "python/reads", "dp[c - w[i]]", knapsack},
		{"cpp: a post-increment index reads the cell before it moves", "cpp/reads", "t[l++]", []string{"t[0]", "t[1]", "t[2]"}},
		{"python: a loop reads each cell once", "python/reads", "total += t[l]", []string{"t[0]", "t[1]", "t[2]"}},
		{"cpp: a 2-d read names the row and its cell", "cpp/reads", "grid[1][2] +", grid},
		{"python: a negative index names the cell it reaches", "python/reads", "grid[1][2] +", grid},
		{"cpp: a pointer reads the array it points into, but a constant offset into a named array is not seen", "cpp/reads-pointers", "*(a + 2) + p[2]", []string{"a[3]"}},
		{"cpp: taking an element's address reads nothing", "cpp/reads-pointers", "&a[1]", nil},
		{"cpp: a struct field reads its element", "cpp/reads-pointers", "jobs[1].e", []string{"jobs[0]", "jobs[1]"}},
		{"cpp: a variable index reads local arrays and std::array", "cpp/reads-pointers", "b[k] + b[0]", []string{"b[1]", "c[0]", "c[1]"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := readsOnLine(t, filepath.Join("fixtures", tc.fixture), tc.line)
			if diff := cmp.Diff(tc.want, got); diff != "" {
				t.Errorf("cells read on the line with %q (-want +got):\n%s", tc.line, diff)
			}
		})
	}
}

func readsOnLine(t *testing.T, dir, text string) []string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(dir, "expected.trace.json"))
	if err != nil {
		t.Fatal(err)
	}
	var tr trace.Trace
	if err := json.Unmarshal(raw, &tr); err != nil {
		t.Fatal(err)
	}
	src, err := os.ReadFile(filepath.Join(dir, tr.Source.File))
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(string(src), "\n")
	line := slices.IndexFunc(lines, func(l string) bool { return strings.Contains(l, text) }) + 1
	if line == 0 {
		t.Fatalf("no line of %s contains %q", dir, text)
	}

	frames := map[string]trace.Frame{}
	heap := map[string]trace.HeapObject{}
	read := map[string]bool{}
	ran := false
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
		if st.PrevLine == nil || *st.PrevLine != line {
			continue
		}
		ran = true
		if st.Access == nil {
			t.Fatalf("step %d ran line %d but has no access", st.I+1, line)
		}
		names := cellNames(st.Stack, frames, heap)
		for _, a := range st.Access {
			read[fmt.Sprintf("%s[%d]", names[a.Obj], a.Path[0])] = true
		}
	}
	if !ran {
		t.Fatalf("no step ran line %d of %s", line, dir)
	}
	if len(read) == 0 {
		return nil
	}
	return slices.Sorted(maps.Keys(read))
}

// cellNames names each object by the variable that holds it, and a row by its sequence's name and index.
func cellNames(stack []string, frames map[string]trace.Frame, heap map[string]trace.HeapObject) map[string]string {
	names := map[string]string{}
	var queue []string
	for _, id := range stack {
		for _, l := range frames[id].Locals {
			if l.Value.T == trace.ValueTRef && names[*l.Value.ID] == "" {
				names[*l.Value.ID] = l.Name
				queue = append(queue, *l.Value.ID)
			}
		}
	}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		o := heap[id]
		start := 0
		if o.Window != nil {
			start = o.Window.Start
		}
		for k, v := range o.Items {
			if v.T == trace.ValueTRef && names[*v.ID] == "" {
				names[*v.ID] = fmt.Sprintf("%s[%d]", names[id], start+k)
				queue = append(queue, *v.ID)
			}
		}
	}
	return names
}
