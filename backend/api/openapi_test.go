package api_test

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/goccy/go-yaml"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

const (
	spec      = "openapi.yaml"
	oasSchema = "https://spec.openapis.org/oas/3.1/schema-base/2025-09-15"
)

func TestSpecIsValidOpenAPI(t *testing.T) {
	c := jsonschema.NewCompiler()
	c.AssertFormat()
	paths, err := filepath.Glob("testdata/oas/*.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		doc := decodeJSON(t, raw)
		id, _ := doc.(map[string]any)["$id"].(string)
		if err := c.AddResource(id, doc); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
	}

	sch, err := c.Compile(oasSchema)
	if err != nil {
		t.Fatal(err)
	}
	if err := sch.Validate(loadSpec(t)); err != nil {
		t.Fatal(err)
	}
}

func TestExamplesMatchSchemas(t *testing.T) {
	doc := loadSpec(t)
	c := compiler(t, doc)
	examples := findExamples(t, doc)
	if len(examples) == 0 {
		t.Fatal("spec has no examples")
	}

	for _, ex := range examples {
		t.Run(ex.path, func(t *testing.T) {
			sch, err := c.Compile(spec + "#" + ex.schema)
			if err != nil {
				t.Fatal(err)
			}
			if err := sch.Validate(ex.value); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestVisualizationRequiresFieldsOfItsStatus(t *testing.T) {
	tests := []struct {
		name    string
		example string
		field   string
	}{
		{"tracing without progress", "Tracing", "progress"},
		{"completed without trace", "Completed", "trace"},
		{"completed without expiresAt", "Completed", "expiresAt"},
		{"failed without failure", "FailedBuild", "failure"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			doc := loadSpec(t)
			sch, err := compiler(t, doc).Compile(spec + "#/components/schemas/Visualization")
			if err != nil {
				t.Fatal(err)
			}
			viz := resolve(t, doc, "/components/examples/"+tc.example+"/value").(map[string]any)
			delete(viz, tc.field)
			if err := sch.Validate(viz); err == nil {
				t.Fatal("visualization is valid")
			}
		})
	}
}

type example struct {
	path   string
	schema string
	value  any
}

func findExamples(t *testing.T, doc any) []example {
	t.Helper()
	var found []example
	var walk func(ptr string, node any)
	walk = func(ptr string, node any) {
		switch n := node.(type) {
		case map[string]any:
			if examples, ok := n["examples"].(map[string]any); ok && n["schema"] != nil {
				for name, ex := range examples {
					found = append(found, example{
						path:   ptr + "/examples/" + name,
						schema: ptr + "/schema",
						value:  exampleValue(t, doc, ex),
					})
				}
			}
			for key, child := range n {
				walk(ptr+"/"+escape(key), child)
			}
		case []any:
			for i, child := range n {
				walk(ptr+"/"+strconv.Itoa(i), child)
			}
		}
	}
	walk("", doc)

	slices.SortFunc(found, func(a, b example) int { return strings.Compare(a.path, b.path) })
	return found
}

func exampleValue(t *testing.T, doc, ex any) any {
	t.Helper()
	obj := ex.(map[string]any)
	if ref, ok := obj["$ref"].(string); ok {
		obj = resolve(t, doc, strings.TrimPrefix(ref, "#")).(map[string]any)
	}
	value, ok := obj["value"]
	if !ok {
		t.Fatalf("example %v has no value", ex)
	}
	return value
}

func resolve(t *testing.T, doc any, pointer string) any {
	t.Helper()
	node := doc
	for _, token := range strings.Split(pointer, "/")[1:] {
		key := strings.ReplaceAll(strings.ReplaceAll(token, "~1", "/"), "~0", "~")
		obj, ok := node.(map[string]any)
		if !ok {
			t.Fatalf("%s: %q is not in an object", pointer, key)
		}
		if node, ok = obj[key]; !ok {
			t.Fatalf("%s: no field %q", pointer, key)
		}
	}
	return node
}

func escape(key string) string {
	return strings.ReplaceAll(strings.ReplaceAll(key, "~", "~0"), "/", "~1")
}

func compiler(t *testing.T, doc any) *jsonschema.Compiler {
	t.Helper()
	c := jsonschema.NewCompiler()
	c.AssertFormat()
	if err := c.AddResource(spec, doc); err != nil {
		t.Fatal(err)
	}
	return c
}

func loadSpec(t *testing.T) any {
	t.Helper()
	raw, err := os.ReadFile(spec)
	if err != nil {
		t.Fatal(err)
	}
	js, err := yaml.YAMLToJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	return decodeJSON(t, js)
}

func decodeJSON(t *testing.T, raw []byte) any {
	t.Helper()
	v, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("decode json: %v", err)
	}
	return v
}
