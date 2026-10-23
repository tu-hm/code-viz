package schema_test

import (
	"strings"
	"testing"

	"github.com/tu-hm/code-viz/backend/schema"
)

func TestValidatorErrorsDoNotQuoteTheInput(t *testing.T) {
	v, err := schema.New()
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name string
		line string
	}{
		{"value that fails a pattern", `{"type":"step","event":"line","line":1,"prevLine":null,"stack":[{"id":"1","name":"f","kind":"function","line":1,"locals":[{"name":"p","value":{"t":"ptr","addr":"SECRET"}}],"returnValue":null}],"heap":{},"error":null}`},
		{"value outside an enum", `{"type":"out","stream":"SECRET","data":""}`},
		{"line that is not JSON", `SECRET`},
		{"JSON value followed by more data", `{"type":"log","level":"info","message":"x"} "SECRET"`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := v.Wire([]byte(tc.line))
			if err == nil {
				t.Fatal("line is valid")
			}
			if strings.Contains(err.Error(), "SECRET") {
				t.Errorf("error quotes the line: %v", err)
			}
		})
	}
}
