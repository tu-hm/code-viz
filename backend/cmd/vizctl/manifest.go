package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/goccy/go-yaml"
)

type manifest struct {
	ID         string `yaml:"id"`
	Image      string `yaml:"image"`
	SourceFile string `yaml:"sourceFile"`
	Build      struct {
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
}

const manifests = "adapters/*/manifest.yaml"

func findManifest(id string) (manifest, error) {
	paths, err := filepath.Glob(manifests)
	if err != nil {
		return manifest{}, err
	}
	var ids []string
	for _, path := range paths {
		m, err := readManifest(path)
		if err != nil {
			return manifest{}, err
		}
		if m.ID == id {
			return m, nil
		}
		ids = append(ids, m.ID)
	}
	return manifest{}, fmt.Errorf("no manifest in %s has id %q (have: %s)", manifests, id, strings.Join(ids, ", "))
}

func readManifest(path string) (manifest, error) {
	raw, err := os.ReadFile(path) //nolint:gosec // path comes from globbing adapters/*/manifest.yaml
	if err != nil {
		return manifest{}, err
	}
	var m manifest
	if err := yaml.Unmarshal(raw, &m); err != nil {
		return manifest{}, fmt.Errorf("%s: %w", path, err)
	}
	required := []struct {
		field string
		ok    bool
	}{
		{"id", m.ID != ""},
		{"image", m.Image != ""},
		{"sourceFile", m.SourceFile != "" && !strings.Contains(m.SourceFile, "/")},
		{"build.cmd", len(m.Build.Cmd) > 0},
		{"build.timeoutMs", m.Build.TimeoutMs > 0},
		{"trace.cmd", len(m.Trace.Cmd) > 0},
	}
	for _, r := range required {
		if !r.ok {
			return manifest{}, fmt.Errorf("%s: %s is missing or invalid", path, r.field)
		}
	}
	return m, nil
}
