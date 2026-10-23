// Package schema validates documents against the trace and wire JSON Schemas in this directory (D14).
package schema

import (
	"bytes"
	"embed"
	"errors"
	"fmt"
	"path"
	"slices"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed trace.v1.schema.json wire.v1.schema.json
var files embed.FS

// Validator is safe for concurrent use.
type Validator struct {
	wire  *jsonschema.Schema
	trace *jsonschema.Schema
}

// New compiles the embedded schemas.
func New() (*Validator, error) {
	c := jsonschema.NewCompiler()
	ids := map[string]string{}
	for _, name := range []string{"trace.v1.schema.json", "wire.v1.schema.json"} {
		raw, err := files.ReadFile(name)
		if err != nil {
			return nil, err
		}
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		id, _ := doc.(map[string]any)["$id"].(string)
		if err := c.AddResource(id, doc); err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		ids[name] = id
	}

	v := &Validator{}
	var err error
	if v.wire, err = c.Compile(ids["wire.v1.schema.json"]); err != nil {
		return nil, err
	}
	if v.trace, err = c.Compile(ids["trace.v1.schema.json"]); err != nil {
		return nil, err
	}
	return v, nil
}

// Wire checks one fd-3 line against wire.v1.schema.json. The error names the schema keywords that failed and never quotes the line, so it is safe to log (§7.8).
func (v *Validator) Wire(line []byte) error {
	return validate(v.wire, line)
}

// Trace checks a whole trace document against trace.v1.schema.json, with errors redacted like Wire.
func (v *Validator) Trace(doc []byte) error {
	return validate(v.trace, doc)
}

func validate(sch *jsonschema.Schema, raw []byte) error {
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return errors.New("not a single JSON value")
	}
	err = sch.Validate(doc)
	var verr *jsonschema.ValidationError
	if !errors.As(err, &verr) {
		return err
	}
	var failed []string
	for _, leaf := range leaves(verr) {
		url, fragment, _ := strings.Cut(leaf.SchemaURL, "#")
		failed = append(failed, path.Base(url)+"#"+fragment+"/"+strings.Join(leaf.ErrorKind.KeywordPath(), "/"))
	}
	slices.Sort(failed)
	return fmt.Errorf("fails %s", strings.Join(slices.Compact(failed), ", "))
}

func leaves(e *jsonschema.ValidationError) []*jsonschema.ValidationError {
	if len(e.Causes) == 0 {
		return []*jsonschema.ValidationError{e}
	}
	var out []*jsonschema.ValidationError
	for _, c := range e.Causes {
		out = append(out, leaves(c)...)
	}
	return out
}
