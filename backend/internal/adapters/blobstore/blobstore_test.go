package blobstore_test

import (
	"bytes"
	"compress/gzip"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/adapters/blobstore"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

func TestPutStoresGzippedJSONUnderChunkKey(t *testing.T) {
	bucket := createBucket(t)
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write([]byte(`[{"line":1}]`)); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}

	if err := newBucket(t, s3, bucket).Put(t.Context(), domain.ChunkKey("t7", "trc_0123", 3), buf.Bytes()); err != nil {
		t.Fatal(err)
	}

	resp := do(t, http.MethodGet, s3+"/"+bucket+"/t7/trc_0123/chunk-0003.json.gz")
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

	err := newBucket(t, down.URL, "down").Put(t.Context(), domain.ChunkKey("t7", "trc_0123", 0), []byte("x"))
	if !errors.Is(err, domain.ErrInfra) {
		t.Fatalf("err = %v, want ErrInfra", err)
	}
	if got := attempts.Load(); got != 4 {
		t.Errorf("attempts = %d, want 4", got)
	}
}

func TestPutAndDeleteOnUnreachableEndpointAreInfraErrors(t *testing.T) {
	var lc net.ListenConfig
	ln, err := lc.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	closed := "http://" + ln.Addr().String()
	if err := ln.Close(); err != nil {
		t.Fatal(err)
	}
	b := newBucket(t, closed, "down")
	key := domain.ChunkKey("t7", "trc_0123", 0)

	if err := b.Put(t.Context(), key, []byte("x")); !errors.Is(err, domain.ErrInfra) {
		t.Errorf("put: err = %v, want ErrInfra", err)
	}
	if err := b.Delete(t.Context(), []string{key}); !errors.Is(err, domain.ErrInfra) {
		t.Errorf("delete: err = %v, want ErrInfra", err)
	}
}

func TestSignedURLDownloadsFromThePublicEndpoint(t *testing.T) {
	bucket := createBucket(t)
	target, err := url.Parse(s3)
	if err != nil {
		t.Fatal(err)
	}
	public := httptest.NewServer(&httputil.ReverseProxy{Rewrite: func(r *httputil.ProxyRequest) {
		r.SetURL(target)
		r.Out.Host = r.In.Host
	}})
	t.Cleanup(public.Close)

	b := newBucketWithPublic(t, s3, public.URL, bucket)
	key := domain.ChunkKey("t7", "trc_0123", 0)
	if err := b.Put(t.Context(), key, []byte("chunk")); err != nil {
		t.Fatal(err)
	}
	signed, err := b.Sign(t.Context(), key, 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}

	if want := public.URL + "/" + bucket + "/" + key + "?"; !strings.HasPrefix(signed, want) {
		t.Errorf("url = %s, want prefix %s", signed, want)
	}
	u, err := url.Parse(signed)
	if err != nil {
		t.Fatal(err)
	}
	if got := u.Query().Get("X-Amz-Expires"); got != "900" {
		t.Errorf("X-Amz-Expires = %q, want 900", got)
	}
	resp := do(t, http.MethodGet, signed)
	if resp.StatusCode != http.StatusOK || string(resp.body) != "chunk" {
		t.Errorf("get signed url: HTTP %d, body %q; want 200, \"chunk\"", resp.StatusCode, resp.body)
	}
}

func TestDeleteRemovesTheKeysAndSkipsMissingOnes(t *testing.T) {
	bucket := createBucket(t)
	b := newBucket(t, s3, bucket)
	keys := []string{domain.ChunkKey("t7", "trc_a", 0), domain.ChunkKey("t7", "trc_a", 1), domain.ChunkKey("t7", "trc_b", 0)}
	for _, key := range keys {
		if err := b.Put(t.Context(), key, []byte("x")); err != nil {
			t.Fatal(err)
		}
	}

	if err := b.Delete(t.Context(), []string{keys[0], keys[1], domain.ChunkKey("t7", "trc_a", 2)}); err != nil {
		t.Fatal(err)
	}

	got := map[string]int{}
	for _, key := range keys {
		got[key] = do(t, http.MethodGet, s3+"/"+bucket+"/"+key).StatusCode
	}
	want := map[string]int{keys[0]: http.StatusNotFound, keys[1]: http.StatusNotFound, keys[2]: http.StatusOK}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("GET status by key (-want +got):\n%s", diff)
	}
}

func newBucket(t *testing.T, endpoint, bucket string) ports.BlobStore {
	t.Helper()
	return newBucketWithPublic(t, endpoint, "", bucket)
}

func newBucketWithPublic(t *testing.T, endpoint, public, bucket string) ports.BlobStore {
	t.Helper()
	t.Setenv("AWS_REGION", "us-east-1")
	t.Setenv("AWS_ACCESS_KEY_ID", "viz")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "viz")
	b, err := blobstore.New(t.Context(), blobstore.Config{Endpoint: endpoint, PublicEndpoint: public, Bucket: bucket, PathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	return b
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
