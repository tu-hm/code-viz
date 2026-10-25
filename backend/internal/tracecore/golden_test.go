package tracecore_test

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/tracecore"
)

var update = flag.Bool("update", false, "rewrite testdata/golden from the current output")

func TestGolden(t *testing.T) {
	var inputs []string
	for _, pattern := range []string{"../../schema/testdata/wire/*.ndjson", "testdata/wire/*.ndjson"} {
		paths, err := filepath.Glob(pattern)
		if err != nil {
			t.Fatal(err)
		}
		inputs = append(inputs, paths...)
	}
	if len(inputs) == 0 {
		t.Fatal("no wire inputs")
	}

	seen := map[string]bool{}
	for _, in := range inputs {
		name := strings.TrimSuffix(filepath.Base(in), ".ndjson")
		if seen[name] {
			t.Fatalf("two wire inputs are named %s", name)
		}
		seen[name] = true

		t.Run(name, func(t *testing.T) {
			raw, err := os.ReadFile(in)
			if err != nil {
				t.Fatal(err)
			}
			res := mustRecord(t, config(t, 1000, tracecore.DefaultLimits), tracecore.Outcome{}, []write{{3, string(raw)}})
			doc, err := json.Marshal(res.Trace())
			if err != nil {
				t.Fatal(err)
			}
			if err := validator(t).Trace(doc); err != nil {
				t.Fatalf("trace fails the trace schema: %v", err)
			}

			var got any
			if err := json.Unmarshal(doc, &got); err != nil {
				t.Fatal(err)
			}
			got = mask(got)
			path := filepath.Join("testdata", "golden", name+".trace.json")
			if *update {
				var out bytes.Buffer
				enc := json.NewEncoder(&out)
				enc.SetEscapeHTML(false)
				enc.SetIndent("", "  ")
				if err := enc.Encode(got); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, out.Bytes(), 0o644); err != nil {
					t.Fatal(err)
				}
			}

			wantRaw, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("%v (run with -update to create it)", err)
			}
			var want any
			if err := json.Unmarshal(wantRaw, &want); err != nil {
				t.Fatal(err)
			}
			if diff := cmp.Diff(want, got); diff != "" {
				t.Errorf("trace (-want +got):\n%s", diff)
			}
		})
	}
}

var address = regexp.MustCompile(`0x[0-9a-f]{5,}`)

func mask(v any) any {
	switch v := v.(type) {
	case map[string]any:
		for k, child := range v {
			v[k] = mask(child)
		}
		if typ, _ := v["type"].(string); strings.Contains(typ, "long double") && v["v"] != nil {
			v["v"] = "masked"
		}
		return v
	case []any:
		for i, child := range v {
			v[i] = mask(child)
		}
		return v
	case string:
		return address.ReplaceAllString(v, "0xmasked")
	}
	return v
}
