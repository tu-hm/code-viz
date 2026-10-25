package tracecore_test

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/tu-hm/code-viz/backend/internal/tracecore"
)

func FuzzWire(f *testing.F) {
	paths, err := filepath.Glob("../../schema/testdata/wire/*.ndjson")
	if err != nil {
		f.Fatal(err)
	}
	own, err := filepath.Glob("testdata/wire/*.ndjson")
	if err != nil {
		f.Fatal(err)
	}
	for _, path := range append(paths, own...) {
		raw, err := os.ReadFile(path)
		if err != nil {
			f.Fatal(err)
		}
		f.Add(raw, uint8(0))
	}
	f.Add([]byte(helloLine+"\n"+`{"type":"step"`), uint8(3))

	lim := tracecore.DefaultLimits
	lim.TraceBytes, lim.OutputBytes, lim.HeapObjects, lim.Frames, lim.StringChars, lim.Items = 64<<10, 64, 3, 2, 4, 2
	lim.Cells, lim.StepCells = 2, 4
	cfg := config(f, 4, lim)
	val := validator(f)

	f.Fuzz(func(t *testing.T, data []byte, split uint8) {
		rec := tracecore.NewRecorder(cfg)
		at := min(int(split), len(data))
		var runErr error
		for _, part := range [][]byte{data[:at], data[at:]} {
			if _, err := rec.Wire().Write(part); err != nil {
				runErr = err
				break
			}
		}

		res, err := rec.Finish(tracecore.Outcome{}, runErr)
		if err != nil {
			if !errors.Is(err, tracecore.ErrMalformed) {
				t.Fatalf("err = %v, want ErrMalformed", err)
			}
			return
		}
		doc, err := json.Marshal(res.Trace())
		if err != nil {
			t.Fatal(err)
		}
		if err := val.Trace(doc); err != nil {
			t.Fatalf("accepted wire input gave an invalid trace: %v", err)
		}
		if _, err := res.Chunks(); err != nil {
			t.Fatal(err)
		}
	})
}
