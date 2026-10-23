// Package manifest loads the language adapter manifests (§10.2): adapters/ in dev, the mounted ConfigMap in production.
package manifest

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/goccy/go-yaml"

	"github.com/tu-hm/code-viz/backend/internal/domain"
)

type file struct {
	ID          string `yaml:"id"`
	DisplayName string `yaml:"displayName"`
	EditorMode  string `yaml:"editorMode"`
	Enabled     bool   `yaml:"enabled"`
	Image       string `yaml:"image"`
	SourceFile  string `yaml:"sourceFile"`
	Build       *struct {
		Cmd                   []string `yaml:"cmd"`
		TimeoutMs             int      `yaml:"timeoutMs"`
		UnsupportedModuleExit int      `yaml:"unsupportedModuleExit"`
	} `yaml:"build"`
	Trace struct {
		Cmd []string          `yaml:"cmd"`
		Env map[string]string `yaml:"env"`
	} `yaml:"trace"`
	Modules struct {
		Allow []string `yaml:"allow"`
	} `yaml:"modules"`
	Capabilities struct {
		ReturnValues  bool `yaml:"returnValues"`
		Pointers      bool `yaml:"pointers"`
		Exceptions    bool `yaml:"exceptions"`
		StartAtLines  bool `yaml:"startAtLines"`
		CaptureRanges bool `yaml:"captureRanges"`
	} `yaml:"capabilities"`
}

type Set struct {
	byID map[string]domain.Manifest
}

// Load reads every dir/*/manifest.yaml. It fails on an invalid manifest, a repeated id, or none at all.
func Load(dir string) (*Set, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*", "manifest.yaml"))
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return nil, fmt.Errorf("no */manifest.yaml in %s", dir)
	}

	byID := make(map[string]domain.Manifest, len(paths))
	for _, path := range paths {
		m, err := Read(path)
		if err != nil {
			return nil, err
		}
		if _, ok := byID[m.ID]; ok {
			return nil, fmt.Errorf("%s: another manifest in %s has id %q", path, dir, m.ID)
		}
		byID[m.ID] = m
	}
	return &Set{byID: byID}, nil
}

func (s *Set) Manifest(id string) (domain.Manifest, bool) {
	m, ok := s.byID[id]
	return m, ok
}

func (s *Set) Manifests() []domain.Manifest {
	return slices.SortedFunc(maps.Values(s.byID), func(a, b domain.Manifest) int {
		return strings.Compare(a.ID, b.ID)
	})
}

// Read parses and validates one manifest.
func Read(path string) (domain.Manifest, error) {
	raw, err := os.ReadFile(path) //nolint:gosec // path names a manifest the operator deployed
	if err != nil {
		return domain.Manifest{}, err
	}
	var f file
	if err := yaml.Unmarshal(raw, &f); err != nil {
		return domain.Manifest{}, fmt.Errorf("%s: %w", path, err)
	}
	required := []struct {
		field string
		ok    bool
	}{
		{"id", f.ID != ""},
		{"displayName", f.DisplayName != ""},
		{"editorMode", f.EditorMode != ""},
		{"image", f.Image != ""},
		{"sourceFile", f.SourceFile != "" && !strings.Contains(f.SourceFile, "/")},
		{"build.cmd", f.Build == nil || len(f.Build.Cmd) > 0},
		{"build.timeoutMs", f.Build == nil || f.Build.TimeoutMs > 0},
		{"trace.cmd", len(f.Trace.Cmd) > 0},
	}
	for _, r := range required {
		if !r.ok {
			return domain.Manifest{}, fmt.Errorf("%s: %s is missing or invalid", path, r.field)
		}
	}

	m := domain.Manifest{
		ID:             f.ID,
		DisplayName:    f.DisplayName,
		EditorMode:     f.EditorMode,
		Enabled:        f.Enabled,
		Image:          f.Image,
		SourceFile:     f.SourceFile,
		TraceCmd:       f.Trace.Cmd,
		AllowedModules: f.Modules.Allow,
		Capabilities:   domain.Capabilities(f.Capabilities),
	}
	if f.Build != nil {
		m.Build = &domain.Build{
			Cmd:                   f.Build.Cmd,
			Timeout:               time.Duration(f.Build.TimeoutMs) * time.Millisecond,
			UnsupportedModuleExit: f.Build.UnsupportedModuleExit,
		}
	}
	for _, k := range slices.Sorted(maps.Keys(f.Trace.Env)) {
		m.TraceEnv = append(m.TraceEnv, k+"="+f.Trace.Env[k])
	}
	return m, nil
}
