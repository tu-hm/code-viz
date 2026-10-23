package blobstore_test

import (
	"bytes"
	"compress/gzip"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"

	"github.com/goccy/go-yaml"
	"github.com/google/go-cmp/cmp"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/tu-hm/code-viz/backend/internal/adapters/blobstore"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

const bucket = "viz-test"

func TestPutStoresGzippedJSONUnderChunkKey(t *testing.T) {
	endpoint := startSeaweedFS(t)
	if resp := do(t, http.MethodPut, endpoint+"/"+bucket); resp.StatusCode != http.StatusOK {
		t.Fatalf("create bucket: HTTP %d", resp.StatusCode)
	}
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write([]byte(`[{"line":1}]`)); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}

	if err := newBucket(t, endpoint).Put(t.Context(), domain.ChunkKey("t7", "trc_0123", 3), buf.Bytes()); err != nil {
		t.Fatal(err)
	}

	resp := do(t, http.MethodGet, endpoint+"/"+bucket+"/t7/trc_0123/chunk-0003.json.gz")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get chunk: HTTP %d", resp.StatusCode)
	}
	got := map[string]string{
		"Content-Type":     resp.Header.Get("Content-Type"),
		"Content-Encoding": resp.Header.Get("Content-Encoding"),
		"Cache-Control":    resp.Header.Get("Cache-Control"),
	}
	want := map[string]string{
		"Content-Type":     "application/json",
		"Content-Encoding": "gzip",
		"Cache-Control":    "private, max-age=86400, immutable",
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("headers (-want +got):\n%s", diff)
	}
	if !bytes.Equal(resp.body, buf.Bytes()) {
		t.Errorf("body = %x, want %x", resp.body, buf.Bytes())
	}
}

func TestPutRetriesThreeTimesThenFailsAsInfraError(t *testing.T) {
	var attempts atomic.Int32
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(down.Close)

	err := newBucket(t, down.URL).Put(t.Context(), domain.ChunkKey("t7", "trc_0123", 0), []byte("x"))
	if !errors.Is(err, domain.ErrInfra) {
		t.Fatalf("err = %v, want ErrInfra", err)
	}
	if got := attempts.Load(); got != 4 {
		t.Errorf("attempts = %d, want 4", got)
	}
}

func TestPutToUnreachableEndpointIsInfraError(t *testing.T) {
	var lc net.ListenConfig
	ln, err := lc.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	closed := "http://" + ln.Addr().String()
	if err := ln.Close(); err != nil {
		t.Fatal(err)
	}

	err = newBucket(t, closed).Put(t.Context(), domain.ChunkKey("t7", "trc_0123", 0), []byte("x"))
	if !errors.Is(err, domain.ErrInfra) {
		t.Fatalf("err = %v, want ErrInfra", err)
	}
}

func newBucket(t *testing.T, endpoint string) ports.BlobStore {
	t.Helper()
	t.Setenv("AWS_REGION", "us-east-1")
	t.Setenv("AWS_ACCESS_KEY_ID", "viz")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "viz")
	b, err := blobstore.New(t.Context(), blobstore.Config{Endpoint: endpoint, Bucket: bucket, PathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func startSeaweedFS(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile("../../../compose.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var compose struct {
		Services map[string]struct {
			Image   string   `yaml:"image"`
			Command []string `yaml:"command"`
		} `yaml:"services"`
	}
	if err := yaml.Unmarshal(raw, &compose); err != nil {
		t.Fatal(err)
	}
	service := compose.Services["seaweedfs"]

	c, err := testcontainers.GenericContainer(t.Context(), testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        service.Image,
			Cmd:          service.Command,
			ExposedPorts: []string{"8333/tcp"},
			WaitingFor:   wait.ForHTTP("/healthz").WithPort("8333/tcp"),
		},
		Started: true,
	})
	testcontainers.CleanupContainer(t, c, testcontainers.StopTimeout(0))
	if err != nil {
		t.Fatal(err)
	}
	endpoint, err := c.PortEndpoint(t.Context(), "8333/tcp", "http")
	if err != nil {
		t.Fatal(err)
	}
	return endpoint
}

type response struct {
	*http.Response
	body []byte
}

func do(t *testing.T, method, url string) response {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), method, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Accept-Encoding", "gzip")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response{resp, body}
}
