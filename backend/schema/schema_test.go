package schema_test

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

const unset = ""

func compile(t *testing.T, name string) *jsonschema.Schema {
	t.Helper()
	c := jsonschema.NewCompiler()
	ids := map[string]string{}
	for _, path := range glob(t, "*.schema.json") {
		doc := load(t, path)
		id, _ := doc.(map[string]any)["$id"].(string)
		if err := c.AddResource(id, doc); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		ids[path] = id
	}

	sch, err := c.Compile(ids[name])
	if err != nil {
		t.Fatal(err)
	}
	return sch
}

func glob(t *testing.T, pattern string) []string {
	t.Helper()
	paths, err := filepath.Glob(pattern)
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) == 0 {
		t.Fatalf("no files match %s", pattern)
	}
	return paths
}

func load(t *testing.T, path string) any {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return decodeJSON(t, string(raw))
}

func lines(t *testing.T, path string) []string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n")
}

func decodeJSON(t *testing.T, s string) any {
	t.Helper()
	v, err := jsonschema.UnmarshalJSON(strings.NewReader(s))
	if err != nil {
		t.Fatalf("%s: %v", s, err)
	}
	return v
}

func edit(t *testing.T, doc any, pointer, value string) {
	t.Helper()
	keys := strings.Split(pointer, "/")[1:]
	parent := doc
	for _, key := range keys[:len(keys)-1] {
		parent = child(t, parent, key)
	}

	last := keys[len(keys)-1]
	switch p := parent.(type) {
	case map[string]any:
		if value == unset {
			if _, ok := p[last]; !ok {
				t.Fatalf("%s: no such field", pointer)
			}
			delete(p, last)
			return
		}
		p[last] = decodeJSON(t, value)
	case []any:
		p[index(t, p, last)] = decodeJSON(t, value)
	default:
		t.Fatalf("%s: parent is not an object or array", pointer)
	}
}

func child(t *testing.T, node any, key string) any {
	t.Helper()
	switch n := node.(type) {
	case map[string]any:
		c, ok := n[key]
		if !ok {
			t.Fatalf("no field %q", key)
		}
		return c
	case []any:
		return n[index(t, n, key)]
	}
	t.Fatalf("cannot step into %q", key)
	return nil
}

func index(t *testing.T, arr []any, key string) int {
	t.Helper()
	i, err := strconv.Atoi(key)
	if err != nil || i < 0 || i >= len(arr) {
		t.Fatalf("bad index %q for array of %d", key, len(arr))
	}
	return i
}
