package shim_test

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/shim"
)

func TestFramesRoundTrip(t *testing.T) {
	want := []shim.Frame{
		{Stream: shim.Stdout, Data: []byte("out")},
		{Stream: shim.Stderr, Data: []byte("err\n")},
		{Stream: shim.Wire, Data: []byte(`{"type":"hello"}` + "\n")},
		{Stream: shim.Stdout, Data: bytes.Repeat([]byte("x"), shim.MaxPayload)},
		{Stream: shim.Exit, Code: 255, Signal: 64},
	}
	var stream bytes.Buffer
	w := shim.NewWriter(&stream)
	for _, f := range want[:len(want)-1] {
		if err := w.Write(f.Stream, f.Data); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.WriteExit(255, 64); err != nil {
		t.Fatal(err)
	}

	r := shim.NewReader(&stream)
	var got []shim.Frame
	for {
		f, err := r.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		f.Data = bytes.Clone(f.Data)
		got = append(got, f)
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("frames (-want +got):\n%s", diff)
	}
}

func TestReaderRejectsBadFrames(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"stream id 0", "\x00\x00\x00\x00\x01x"},
		{"stream id after exit", "\x05\x00\x00\x00\x01x"},
		{"payload one byte over the max", "\x01\x00\x01\x00\x01"},
		{"payload shorter than its length", "\x01\x00\x00\x00\x05abc"},
		{"header cut short", "\x01\x00\x00"},
		{"exit payload of 7 bytes", "\x04\x00\x00\x00\x07\x00\x00\x00\x00\x00\x00\x00"},
		{"exit code 256", "\x04\x00\x00\x00\x08\x00\x00\x01\x00\x00\x00\x00\x00"},
		{"negative exit code", "\x04\x00\x00\x00\x08\xff\xff\xff\xff\x00\x00\x00\x00"},
		{"signal 65", "\x04\x00\x00\x00\x08\x00\x00\x00\x00\x00\x00\x00\x41"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := shim.NewReader(strings.NewReader(tc.input)).Next()
			if err == nil || errors.Is(err, io.EOF) {
				t.Fatalf("err = %v, want a decode error", err)
			}
		})
	}
}

func FuzzReader(f *testing.F) {
	var seed bytes.Buffer
	w := shim.NewWriter(&seed)
	if err := w.Write(shim.Wire, []byte(`{"type":"step"}`)); err != nil {
		f.Fatal(err)
	}
	if err := w.WriteExit(1, 0); err != nil {
		f.Fatal(err)
	}
	f.Add(seed.Bytes())
	f.Add([]byte("\x01\x00\x01\x00\x00"))
	f.Fuzz(func(t *testing.T, input []byte) {
		r := shim.NewReader(bytes.NewReader(input))
		for {
			fr, err := r.Next()
			if err != nil {
				return
			}
			if fr.Stream < shim.Stdout || fr.Stream > shim.Exit || len(fr.Data) > shim.MaxPayload {
				t.Fatalf("accepted frame on stream %d with %d bytes", fr.Stream, len(fr.Data))
			}
			if fr.Stream == shim.Exit && (fr.Code < 0 || fr.Code > 255 || fr.Signal < 0 || fr.Signal > 64) {
				t.Fatalf("accepted exit code %d, signal %d", fr.Code, fr.Signal)
			}
		}
	})
}
