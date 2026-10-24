package domain_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
)

var (
	capable   = domain.Manifest{ID: "cpp17-gcc", Image: "viz-runner-cpp:13-1", Capabilities: domain.Capabilities{StartAtLines: true, CaptureRanges: true}}
	incapable = domain.Manifest{ID: "python3", Image: "viz-runner-python:3.12.15-1"}
)

func TestCheckRequest(t *testing.T) {
	tests := []struct {
		name   string
		m      domain.Manifest
		source string
		stdin  string
		opts   trace.Options
		want   error
	}{
		{"source of 64 KB passes", incapable, strings.Repeat("x", 64<<10), "", trace.Options{MaxSteps: 1000}, nil},
		{"source over 64 KB is too large", incapable, strings.Repeat("x", 64<<10+1), "", trace.Options{MaxSteps: 1000}, domain.ErrPayloadTooLarge},
		{"stdin of 64 KB passes", incapable, "", strings.Repeat("x", 64<<10), trace.Options{MaxSteps: 1000}, nil},
		{"stdin over 64 KB is too large", incapable, "", strings.Repeat("x", 64<<10+1), trace.Options{MaxSteps: 1000}, domain.ErrPayloadTooLarge},
		{"maxSteps 1 passes", incapable, "", "", trace.Options{MaxSteps: 1}, nil},
		{"maxSteps 0 is invalid", incapable, "", "", trace.Options{MaxSteps: 0}, domain.ErrInvalidRequest},
		{"maxSteps 5000 passes", incapable, "", "", trace.Options{MaxSteps: 5000}, nil},
		{"maxSteps 5001 is invalid", incapable, "", "", trace.Options{MaxSteps: 5001}, domain.ErrInvalidRequest},
		{"start lines pass where the language supports them", capable, "", "", trace.Options{MaxSteps: 1000, StartAtLines: []int{1, 3}}, nil},
		{"start lines are invalid where the language lacks them", incapable, "", "", trace.Options{MaxSteps: 1000, StartAtLines: []int{3}}, domain.ErrInvalidRequest},
		{"no start lines pass where the language lacks them", incapable, "", "", trace.Options{MaxSteps: 1000, StartAtLines: []int{}}, nil},
		{"start line 0 is invalid", capable, "", "", trace.Options{MaxSteps: 1000, StartAtLines: []int{0}}, domain.ErrInvalidRequest},
		{"capture ranges pass where the language supports them", capable, "", "", trace.Options{MaxSteps: 1000, CaptureRanges: map[string][][]int{"dp": {{0, 50}}}}, nil},
		{"capture ranges are invalid where the language lacks them", incapable, "", "", trace.Options{MaxSteps: 1000, CaptureRanges: map[string][][]int{"dp": {{0, 50}}}}, domain.ErrInvalidRequest},
		{"a capture range of one index is invalid", capable, "", "", trace.Options{MaxSteps: 1000, CaptureRanges: map[string][][]int{"dp": {{0}}}}, domain.ErrInvalidRequest},
		{"a capture range of three indexes is invalid", capable, "", "", trace.Options{MaxSteps: 1000, CaptureRanges: map[string][][]int{"dp": {{0, 1, 2}}}}, domain.ErrInvalidRequest},
		{"a negative capture start is invalid", capable, "", "", trace.Options{MaxSteps: 1000, CaptureRanges: map[string][][]int{"dp": {{-1, 5}}}}, domain.ErrInvalidRequest},
		{"a negative capture end is invalid", capable, "", "", trace.Options{MaxSteps: 1000, CaptureRanges: map[string][][]int{"dp": {{0, -1}}}}, domain.ErrInvalidRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := domain.CheckRequest(tt.m, tt.source, tt.stdin, tt.opts); !errors.Is(err, tt.want) {
				t.Errorf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestNormalizeOptions(t *testing.T) {
	yes, no := true, false
	tests := []struct {
		name string
		opts trace.Options
		want trace.Options
	}{
		{
			name: "start lines are sorted without repeats",
			opts: trace.Options{MaxSteps: 7, StartAtLines: []int{5, 3, 5, 1}},
			want: trace.Options{MaxSteps: 7, StartAtLines: []int{1, 3, 5}},
		},
		{
			name: "missing start lines become empty",
			opts: trace.Options{MaxSteps: 7},
			want: trace.Options{MaxSteps: 7, StartAtLines: []int{}},
		},
		{
			name: "each variable's ranges are sorted without repeats",
			opts: trace.Options{MaxSteps: 7, CaptureRanges: map[string][][]int{"a": {{5, 9}, {0, 2}, {5, 9}}, "b": {{3, 4}, {1, 8}}}},
			want: trace.Options{MaxSteps: 7, StartAtLines: []int{}, CaptureRanges: map[string][][]int{"a": {{0, 2}, {5, 9}}, "b": {{1, 8}, {3, 4}}}},
		},
		{
			name: "a variable without ranges is left out",
			opts: trace.Options{MaxSteps: 7, CaptureRanges: map[string][][]int{"a": {}, "b": {{0, 1}}}},
			want: trace.Options{MaxSteps: 7, StartAtLines: []int{}, CaptureRanges: map[string][][]int{"b": {{0, 1}}}},
		},
		{
			name: "no variable with ranges leaves no capture ranges",
			opts: trace.Options{MaxSteps: 7, CaptureRanges: map[string][][]int{"a": {}}},
			want: trace.Options{MaxSteps: 7, StartAtLines: []int{}},
		},
		{
			name: "showInternals false is left out",
			opts: trace.Options{MaxSteps: 7, ShowInternals: &no},
			want: trace.Options{MaxSteps: 7, StartAtLines: []int{}},
		},
		{
			name: "showInternals true is kept",
			opts: trace.Options{MaxSteps: 7, ShowInternals: &yes},
			want: trace.Options{MaxSteps: 7, StartAtLines: []int{}, ShowInternals: &yes},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if diff := cmp.Diff(tt.want, domain.NormalizeOptions(tt.opts)); diff != "" {
				t.Errorf("options (-want +got):\n%s", diff)
			}
		})
	}
}

func TestCacheKey(t *testing.T) {
	type request struct {
		m             domain.Manifest
		source, stdin string
		opts          trace.Options
	}
	base := request{capable, "int main() {}", "1 2", trace.Options{MaxSteps: 1000, StartAtLines: []int{2, 4}}}
	with := func(change func(r *request)) request {
		r := base
		change(&r)
		return r
	}
	no := false
	tests := []struct {
		name string
		b    request
		same bool
	}{
		{"start lines in another order trace the same", with(func(r *request) { r.opts.StartAtLines = []int{4, 2} }), true},
		{"repeated start lines trace the same", with(func(r *request) { r.opts.StartAtLines = []int{2, 4, 4} }), true},
		{"showInternals false traces the same as unset", with(func(r *request) { r.opts.ShowInternals = &no }), true},
		{"another source", with(func(r *request) { r.source = "int main() { return 1; }" }), false},
		{"another stdin", with(func(r *request) { r.stdin = "1 3" }), false},
		{"another language", with(func(r *request) { r.m.ID = "c11-gcc" }), false},
		{"another runner image", with(func(r *request) { r.m.Image = "viz-runner-cpp:13-2" }), false},
		{"another step limit", with(func(r *request) { r.opts.MaxSteps = 999 }), false},
		{"another start line", with(func(r *request) { r.opts.StartAtLines = []int{2, 5} }), false},
		{"text moved from source to stdin", with(func(r *request) { r.source, r.stdin = "int main() {", "}1 2" }), false},
		{"text moved from language to image", with(func(r *request) { r.m.ID, r.m.Image = "cpp17-gccviz-runner-cpp:13-1", "" }), false},
	}
	want, err := domain.CacheKey(base.m, base.source, base.stdin, base.opts)
	if err != nil {
		t.Fatal(err)
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := domain.CacheKey(tt.b.m, tt.b.source, tt.b.stdin, tt.b.opts)
			if err != nil {
				t.Fatal(err)
			}
			if (got == want) != tt.same {
				t.Errorf("same key = %t, want %t", got == want, tt.same)
			}
		})
	}
}
