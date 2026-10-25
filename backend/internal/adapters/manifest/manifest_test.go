package manifest_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/adapters/manifest"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

const python = `id: python3
displayName: "Python 3.12"
editorMode: python
image: viz-runner-python:3.12.15-1
sourceFile: main.py
build:
  cmd: ["python3", "-I", "/opt/viz/tracer.py", "--check", "main.py"]
  timeoutMs: 10000
  unsupportedModuleExit: 3
trace:
  cmd: ["python3", "-s", "-P", "/opt/viz/tracer.py", "main.py"]
  env: { VIZ_PROTOCOL_FD: "3", PYTHONHASHSEED: "0" }
capabilities:
  returnValues: true
  pointers: false
  exceptions: true
  startAtLines: false
  captureRanges: false
modules:
  allow: [math, random]
enabled: true
rollout: { percent: 100 }
`

const cpp = `id: cpp17-gcc
displayName: "C++17 (GCC 13)"
editorMode: c_cpp
image: viz-runner-cpp:13-1
sourceFile: main.cpp
build:
  cmd: ["g++", "-std=gnu++17", "main.cpp", "-o", "main"]
  safetyFlags: ["-D_GLIBCXX_DEBUG", "-fsanitize=undefined"]
  env: { TMPDIR: /work, LANG: C }
  timeoutMs: 10000
trace:
  cmd: ["gdb", "-q", "-nx", "-batch", "-x", "/opt/viz/trace.py", "--args", "./main"]
enabled: true
`

const node = `id: node22
displayName: "Node.js 22"
editorMode: javascript
image: registry.internal/viz-runner-node:22-1
sourceFile: main.js
trace:
  cmd: ["node", "/opt/viz/tracer.js", "main.js"]
`

func TestLoadReadsEveryManifest(t *testing.T) {
	set, err := manifest.Load(writeManifests(t, map[string]string{"cpp": cpp, "python": python, "node": node}))
	if err != nil {
		t.Fatal(err)
	}
	var adapters ports.Adapters = set

	want := []domain.Manifest{
		{
			ID:          "cpp17-gcc",
			DisplayName: "C++17 (GCC 13)",
			EditorMode:  "c_cpp",
			Enabled:     true,
			Image:       "viz-runner-cpp:13-1",
			SourceFile:  "main.cpp",
			Build: &domain.Build{
				Cmd:         []string{"g++", "-std=gnu++17", "main.cpp", "-o", "main"},
				SafetyFlags: []string{"-D_GLIBCXX_DEBUG", "-fsanitize=undefined"},
				Env:         []string{"LANG=C", "TMPDIR=/work"},
				Timeout:     10 * time.Second,
			},
			TraceCmd: []string{"gdb", "-q", "-nx", "-batch", "-x", "/opt/viz/trace.py", "--args", "./main"},
		},
		{
			ID:          "node22",
			DisplayName: "Node.js 22",
			EditorMode:  "javascript",
			Image:       "registry.internal/viz-runner-node:22-1",
			SourceFile:  "main.js",
			TraceCmd:    []string{"node", "/opt/viz/tracer.js", "main.js"},
		},
		{
			ID:          "python3",
			DisplayName: "Python 3.12",
			EditorMode:  "python",
			Enabled:     true,
			Image:       "viz-runner-python:3.12.15-1",
			SourceFile:  "main.py",
			Build: &domain.Build{
				Cmd:                   []string{"python3", "-I", "/opt/viz/tracer.py", "--check", "main.py"},
				Timeout:               10 * time.Second,
				UnsupportedModuleExit: 3,
			},
			TraceCmd:       []string{"python3", "-s", "-P", "/opt/viz/tracer.py", "main.py"},
			TraceEnv:       []string{"PYTHONHASHSEED=0", "VIZ_PROTOCOL_FD=3"},
			AllowedModules: []string{"math", "random"},
			Capabilities:   domain.Capabilities{ReturnValues: true, Exceptions: true},
		},
	}
	if diff := cmp.Diff(want, adapters.Manifests()); diff != "" {
		t.Errorf("Manifests() (-want +got):\n%s", diff)
	}
	got, ok := adapters.Manifest("python3")
	if diff := cmp.Diff(want[2], got); !ok || diff != "" {
		t.Errorf("Manifest(python3) = _, %v (-want +got):\n%s", ok, diff)
	}
	if _, ok := adapters.Manifest("ruby"); ok {
		t.Error("Manifest(ruby) found a manifest, want none")
	}
}

func TestLoadRejectsInvalidManifests(t *testing.T) {
	tests := []struct {
		name  string
		files map[string]string
		want  string
	}{
		{"source file in a subdirectory", map[string]string{"python": strings.Replace(python, "sourceFile: main.py", "sourceFile: src/main.py", 1)}, ": sourceFile is missing or invalid"},
		{"build without cmd", map[string]string{"python": strings.Replace(python, `cmd: ["python3", "-I"`, `args: ["python3", "-I"`, 1)}, ": build.cmd is missing or invalid"},
		{"build without timeout", map[string]string{"python": strings.Replace(python, "timeoutMs: 10000", "timeoutMs: 0", 1)}, ": build.timeoutMs is missing or invalid"},
		{"image that climbs out of the images directory", map[string]string{"python": strings.Replace(python, "image: viz-runner-python", "image: ../viz-runner-python", 1)}, ": image is missing or invalid"},
		{"image given as an absolute path", map[string]string{"python": strings.Replace(python, "image: viz-runner-python", "image: /viz-runner-python", 1)}, ": image is missing or invalid"},
		{"two manifests with one id", map[string]string{"python": python, "python-copy": python}, `has id "python3"`},
		{"no manifests", map[string]string{}, "no */manifest.yaml"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := manifest.Load(writeManifests(t, tc.files))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want one containing %q", err, tc.want)
			}
		})
	}
}

func writeManifests(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, content := range files {
		if err := os.Mkdir(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name, "manifest.yaml"), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}
