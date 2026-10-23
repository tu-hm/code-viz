// Package shim is the frame format viz-shim writes to its stdout: a 1-byte stream id, a 4-byte big-endian length, then the payload.
package shim

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"sync"
)

const (
	Stdout byte = 1
	Stderr byte = 2
	Wire   byte = 3 // fd 3
	Exit   byte = 4 // payload: exit code, then signal, big-endian uint32 each
)

// MaxPayload is the largest payload a frame carries.
const MaxPayload = 64 << 10

const (
	headerLen = 5
	exitLen   = 8
	maxCode   = 255
	maxSignal = 64
)

// Writer writes frames. It is safe for concurrent use.
type Writer struct {
	mu sync.Mutex
	w  io.Writer
}

func NewWriter(w io.Writer) *Writer {
	return &Writer{w: w}
}

// Write writes p as one frame on stream. p must be at most MaxPayload bytes.
func (w *Writer) Write(stream byte, p []byte) error {
	var hdr [headerLen]byte
	hdr[0] = stream
	binary.BigEndian.PutUint32(hdr[1:], uint32(len(p))) //nolint:gosec // len(p) <= MaxPayload
	w.mu.Lock()
	defer w.mu.Unlock()
	if _, err := w.w.Write(hdr[:]); err != nil {
		return err
	}
	_, err := w.w.Write(p)
	return err
}

func (w *Writer) WriteExit(code, signal int) error {
	var p [exitLen]byte
	binary.BigEndian.PutUint32(p[:4], uint32(code))   //nolint:gosec // wait status: 0..255
	binary.BigEndian.PutUint32(p[4:], uint32(signal)) //nolint:gosec // wait status: 0..64
	return w.Write(Exit, p[:])
}

// Frame is one decoded frame. The next call to Next reuses Data.
type Frame struct {
	Stream byte
	Data   []byte
	Code   int // Exit frames only
	Signal int // Exit frames only
}

// Reader decodes frames from an untrusted stream.
type Reader struct {
	r   io.Reader
	hdr [headerLen]byte
	buf []byte
}

func NewReader(r io.Reader) *Reader {
	return &Reader{r: r, buf: make([]byte, MaxPayload)}
}

// Next returns the next frame, or io.EOF at a clean end of the stream.
func (r *Reader) Next() (Frame, error) {
	if _, err := io.ReadFull(r.r, r.hdr[:]); err != nil {
		return Frame{}, err
	}
	stream := r.hdr[0]
	if stream < Stdout || stream > Exit {
		return Frame{}, fmt.Errorf("frame: unknown stream %d", stream)
	}
	n := binary.BigEndian.Uint32(r.hdr[1:])
	if n > MaxPayload {
		return Frame{}, fmt.Errorf("frame: payload of %d bytes exceeds %d", n, MaxPayload)
	}
	data := r.buf[:n]
	if _, err := io.ReadFull(r.r, data); err != nil {
		if errors.Is(err, io.EOF) {
			err = io.ErrUnexpectedEOF
		}
		return Frame{}, fmt.Errorf("frame: %w", err)
	}
	if stream != Exit {
		return Frame{Stream: stream, Data: data}, nil
	}

	if n != exitLen {
		return Frame{}, fmt.Errorf("frame: exit payload of %d bytes, want %d", n, exitLen)
	}
	code := binary.BigEndian.Uint32(data[:4])
	signal := binary.BigEndian.Uint32(data[4:])
	if code > maxCode || signal > maxSignal {
		return Frame{}, fmt.Errorf("frame: exit code %d, signal %d out of range", code, signal)
	}
	return Frame{Stream: Exit, Code: int(code), Signal: int(signal)}, nil
}
