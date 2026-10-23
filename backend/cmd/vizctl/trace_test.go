package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/adapters/manifest"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/schema"
)

var update = flag.Bool("update", false, "rewrite each fixture's expected.trace.json from a real run")

func TestGoldenTraces(t *testing.T) {
	t.Chdir("../..")
	val, err := schema.New()
	if err != nil {
		t.Fatal(err)
	}
	paths, err := filepath.Glob(manifests)
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) == 0 {
		t.Fatalf("no manifests match %s", manifests)
	}

	for _, path := range paths {
		m, err := manifest.Read(path)
		if err != nil {
			t.Fatal(err)
		}
		lang := filepath.Base(filepath.Dir(path))
		sources, err := filepath.Glob(filepath.Join("fixtures", lang, "*", m.SourceFile))
		if err != nil {
			t.Fatal(err)
		}
		if len(sources) == 0 {
			t.Errorf("no fixtures/%s/*/%s for adapter %s", lang, m.SourceFile, m.ID)
		}

		for _, src := range sources {
			dir := filepath.Dir(src)
			t.Run(lang+"/"+filepath.Base(dir), func(t *testing.T) {
				stdin, err := os.ReadFile(filepath.Join(dir, "stdin"))
				if err != nil && !errors.Is(err, fs.ErrNotExist) {
					t.Fatal(err)
				}
				var stdout, stderr bytes.Buffer
				if code := run(t.Context(), []string{"trace", "--lang", m.ID, src}, bytes.NewReader(stdin), &stdout, &stderr); code != 0 {
					t.Fatalf("vizctl trace exited %d:\n%s", code, stderr.String())
				}
				if err := val.Trace(stdout.Bytes()); err != nil {
					t.Fatalf("trace %v", err)
				}
				var got trace.Trace
				if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
					t.Fatal(err)
				}
				mask(&got)

				golden := filepath.Join(dir, "expected.trace.json")
				if *update {
					var buf bytes.Buffer
					if err := writeTrace(&buf, got); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(golden, buf.Bytes(), 0o644); err != nil {
						t.Fatal(err)
					}
				}
				raw, err := os.ReadFile(golden)
				if err != nil {
					t.Fatalf("%v (run make golden-update to create it)", err)
				}
				var want trace.Trace
				if err := json.Unmarshal(raw, &want); err != nil {
					t.Fatal(err)
				}
				if diff := cmp.Diff(want, got); diff != "" {
					t.Errorf("trace (-want +got):\n%s", diff)
				}
			})
		}
	}
}

var address = regexp.MustCompile(`0x[0-9a-f]+`)

func mask(tr *trace.Trace) {
	tr.ID = "trc_0"
	for _, s := range tr.Steps {
		for id, obj := range s.Heap {
			if obj.Kind != trace.HeapObjectKindOpaque {
				continue
			}
			summary := address.ReplaceAllString(*obj.Summary, "0xmasked")
			obj.Summary = &summary
			s.Heap[id] = obj
		}
	}
}

func TestTraceNamesBuildFailure(t *testing.T) {
	t.Chdir("../..")
	tests := []struct {
		name string
		src  string
		want string
	}{
		{"syntax error is compile_error", "def f(:\n    pass\n", "vizctl trace: compile_error:\nmain.py:1:"},
		{"blocked import is unsupported_module", "import os\nimport numpy\n", "vizctl trace: unsupported_module:\nmain.py:2:1: error: numpy"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := filepath.Join(t.TempDir(), "main.py")
			if err := os.WriteFile(src, []byte(tc.src), 0o644); err != nil {
				t.Fatal(err)
			}
			var stdout, stderr bytes.Buffer
			code := run(t.Context(), []string{"trace", "--lang", "python3", src}, strings.NewReader(""), &stdout, &stderr)
			if code != 1 || !strings.HasPrefix(stderr.String(), tc.want) {
				t.Fatalf("exit %d, stderr:\n%s\nwant exit 1 and stderr starting with:\n%s", code, stderr.String(), tc.want)
			}
			if stdout.Len() != 0 {
				t.Errorf("stdout = %q, want nothing", stdout.String())
			}
		})
	}
}
