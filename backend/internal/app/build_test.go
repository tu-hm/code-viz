package app_test

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/app"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

var gcc = domain.Manifest{
	ID:         "cpp17-gcc",
	SourceFile: "main.cpp",
	Build:      &domain.Build{Cmd: []string{"g++", "main.cpp"}, Timeout: 10 * time.Second},
}

func TestBuildReadsGCCDiagnostics(t *testing.T) {
	errorAt := func(line, column int, msg string) api.Diagnostic {
		return api.Diagnostic{Line: line, Column: column, Severity: api.DiagnosticSeverityError, Message: msg}
	}
	tests := []struct {
		name        string
		dir         string
		exit        ports.Exit
		ok          bool
		diagnostics []api.Diagnostic
		kind        api.FailureKind
	}{
		{
			name:        "a missing semicolon is an error at its line and column",
			dir:         "missing-semicolon",
			exit:        ports.Exit{Code: 1},
			diagnostics: []api.Diagnostic{errorAt(6, 14, "expected ';' before 'return'")},
			kind:        api.FailureKindCompileError,
		},
		{
			name: "an error in a system header takes the user line gcc printed as its context",
			dir:  "no-less-operator",
			exit: ports.Exit{Code: 1},
			diagnostics: []api.Diagnostic{
				errorAt(10, 9, "no match for 'operator<' in '* __first < * __first' (operand types are 'P' and 'P')"),
				errorAt(10, 9, "no match for 'operator<' in '* __first < * __first' (operand types are 'P' and 'P')"),
				errorAt(12, 14, "no match for 'operator<' in '__x < __y' (operand types are 'const P' and 'const P')"),
			},
			kind: api.FailureKindCompileError,
		},
		{
			name: "an error in a system header without an instantiation takes the line that includes it",
			dir:  "private-public",
			exit: ports.Exit{Code: 1},
			diagnostics: []api.Diagnostic{
				errorAt(2, 1, "'struct std::any::_Manager_internal<_Tp>' redeclared with different access"),
				errorAt(2, 1, "'struct std::any::_Manager_external<_Tp>' redeclared with different access"),
				errorAt(2, 1, "'struct std::__cxx11::basic_stringbuf<_CharT, _Traits, _Alloc>::__xfer_bufptrs' redeclared with different access"),
			},
			kind: api.FailureKindCompileError,
		},
		{
			name: "warnings come back from a build that succeeds, without their notes",
			dir:  "shadow-warning",
			ok:   true,
			diagnostics: []api.Diagnostic{
				{Line: 7, Column: 13, Severity: api.DiagnosticSeverityWarning, Message: "declaration of 'n' shadows a previous local [-Wshadow]"},
				{Line: 5, Column: 16, Severity: api.DiagnosticSeverityWarning, Message: "unused variable 'unused' [-Wunused-variable]"},
			},
		},
		{
			name:        "a missing header is a fatal error shown as an error",
			dir:         "missing-header",
			exit:        ports.Exit{Code: 1},
			diagnostics: []api.Diagnostic{errorAt(2, 10, "testlib.h: No such file or directory")},
			kind:        api.FailureKindCompileError,
		},
		{
			name:        "an undefined reference is an error at the line that calls it",
			dir:         "undefined-reference",
			exit:        ports.Exit{Code: 1},
			diagnostics: []api.Diagnostic{errorAt(7, 1, "undefined reference to `solve(int)'")},
			kind:        api.FailureKindCompileError,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			out, err := os.ReadFile(filepath.Join("testdata", "gcc", tc.dir, "build.txt"))
			if err != nil {
				t.Fatal(err)
			}
			b, kind, err := app.Build(t.Context(), &buildBox{out: string(out), exit: tc.exit}, gcc, trace.Options{})
			if err != nil {
				t.Fatal(err)
			}
			b.DurationMs = 0
			want := api.Build{Ok: tc.ok, Diagnostics: tc.diagnostics, Raw: ptr(string(out))}
			if diff := cmp.Diff(want, b); diff != "" {
				t.Errorf("build (-want +got):\n%s", diff)
			}
			if kind != tc.kind {
				t.Errorf("kind = %q, want %q", kind, tc.kind)
			}
		})
	}
}

func FuzzBuildDiagnostics(f *testing.F) {
	paths, err := filepath.Glob("testdata/gcc/*/build.txt")
	if err != nil {
		f.Fatal(err)
	}
	for _, path := range paths {
		out, err := os.ReadFile(path)
		if err != nil {
			f.Fatal(err)
		}
		f.Add(string(out))
	}
	f.Add("main.cpp:99999999999999999999:1: error: x\nmain.cpp:0:1: warning: y\n")

	f.Fuzz(func(t *testing.T, out string) {
		b, _, err := app.Build(t.Context(), &buildBox{out: out, exit: ports.Exit{Code: 1}}, gcc, trace.Options{})
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range b.Diagnostics {
			if d.Line < 1 || d.Column < 1 || !d.Severity.Valid() {
				t.Fatalf("diagnostic %+v is outside the API's Diagnostic", d)
			}
		}
	})
}

func TestBuildRunsTheManifestCommandAndEnv(t *testing.T) {
	cpp := domain.Manifest{
		ID:         "cpp17-gcc",
		SourceFile: "main.cpp",
		Build: &domain.Build{
			Cmd:         []string{"g++", "main.cpp", "-o", "main"},
			SafetyFlags: []string{"-D_GLIBCXX_DEBUG", "-fsanitize=undefined"},
			Env:         []string{"TMPDIR=/work"},
			Timeout:     10 * time.Second,
		},
	}
	checked := []string{"g++", "main.cpp", "-o", "main", "-D_GLIBCXX_DEBUG", "-fsanitize=undefined"}
	yes, no := true, false
	tests := []struct {
		name string
		opts trace.Options
		args []string
	}{
		{"unset checks build with the safety flags", trace.Options{}, checked},
		{"checks switched on build with the safety flags", trace.Options{SafetyChecks: &yes}, checked},
		{"checks switched off build without the safety flags", trace.Options{SafetyChecks: &no}, []string{"g++", "main.cpp", "-o", "main"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			box := &buildBox{}
			if _, _, err := app.Build(t.Context(), box, cpp, tc.opts); err != nil {
				t.Fatal(err)
			}
			if diff := cmp.Diff(tc.args, box.ran.Args); diff != "" {
				t.Errorf("args (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff([]string{"VIZ_MODULES_ALLOW=", "TMPDIR=/work"}, box.ran.Env); diff != "" {
				t.Errorf("env (-want +got):\n%s", diff)
			}
		})
	}
}

type buildBox struct {
	out  string
	exit ports.Exit
	ran  ports.Command
}

func (b *buildBox) Run(_ context.Context, cmd ports.Command) (ports.Exit, error) {
	b.ran = cmd
	_, err := io.WriteString(cmd.Stderr, b.out)
	return b.exit, err
}

func (b *buildBox) Close(context.Context) error { return nil }
