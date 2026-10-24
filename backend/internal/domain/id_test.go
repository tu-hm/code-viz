package domain_test

import (
	"bytes"
	"io"
	"strings"
	"testing"

	"github.com/tu-hm/code-viz/backend/internal/domain"
)

func TestNewIDsHex128BitsFromTheReader(t *testing.T) {
	tests := []struct {
		name string
		new  func(io.Reader) (string, error)
		want string
	}{
		{"visualization", domain.NewVisualizationID, "viz_000102030405060708090a0b0c0d0e0f"},
		{"trace", domain.NewTraceID, "trc_000102030405060708090a0b0c0d0e0f"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, err := tt.new(bytes.NewReader([]byte{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}))
			if err != nil {
				t.Fatal(err)
			}
			if id != tt.want {
				t.Errorf("id = %s, want %s", id, tt.want)
			}
			if _, err := tt.new(strings.NewReader("only 15 bytes..")); err == nil {
				t.Error("id from 15 random bytes, want an error")
			}
		})
	}
}
