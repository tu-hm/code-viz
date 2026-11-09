package http_test

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/goccy/go-yaml"
	"github.com/google/go-cmp/cmp"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/tu-hm/code-viz/backend/internal/adapters/manifest"
	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
	"github.com/tu-hm/code-viz/backend/internal/app"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/ports"
	httptransport "github.com/tu-hm/code-viz/backend/internal/transport/http"
)

const (
	spec = "../../../api/openapi.yaml"
	ide  = "http://localhost:5173"
)

var (
	day0  = time.Date(2026, 10, 24, 8, 0, 0, 0, time.UTC)
	ipKey = []byte("test-ip-hash-key-of-at-least-32-bytes")

	signer = ed25519.NewKeyFromSeed(bytes.Repeat([]byte{7}, ed25519.SeedSize))
	issuer = httptransport.Issuer{Name: "amoj", Keys: map[string]ed25519.PublicKey{"k1": signer.Public().(ed25519.PublicKey)}}
)

func TestEachErrorCodeAnswersWithItsStatusAndTheEnvelope(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	s := newStack(t, newDB(t), 100)
	full := newStack(t, newDB(t), 0)
	down := newStack(t, openDB(t, "viz:viz@tcp(127.0.0.1:1)/viz"), 100)

	s.now = day0.Add(-8 * 24 * time.Hour)
	old := s.create(t, "old")
	s.now = day0.Add(500 * time.Millisecond)
	broken := s.create(t, "broken")
	brokenTrace := traceOf(t, s.db, broken.ID)
	if _, err := s.db.ExecContext(ctx, `UPDATE traces SET build = '{"ok": "yes"}' WHERE id = ?`, brokenTrace); err != nil {
		t.Fatal(err)
	}
	_, err := s.db.ExecContext(ctx, "INSERT INTO usage_daily (subject, day, count) VALUES (?, ?, 100)", subjectOf("198.51.100.9"), domain.QuotaDay(s.now))
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name       string
		s          *stack
		method     string
		path       string
		target     string
		body       string
		header     http.Header
		peer       string
		code       api.ErrorCode
		status     int
		retryAfter string
		hidden     string
	}{
		{
			name: "malformed JSON body", s: s, method: http.MethodPost, path: "/visualizations", target: "/api/v1/visualizations",
			body: "{", code: api.ErrorCodeInvalidRequest, status: http.StatusBadRequest,
		},
		{
			name: "body that is not application/json", s: s, method: http.MethodPost, path: "/visualizations", target: "/api/v1/visualizations",
			body: createBody(t, nil), header: http.Header{"Content-Type": {"text/plain"}},
			code: api.ErrorCodeInvalidRequest, status: http.StatusBadRequest,
		},
		{
			name: "options outside their range", s: s, method: http.MethodPost, path: "/visualizations", target: "/api/v1/visualizations",
			body: createBody(t, func(r *api.CreateVisualizationRequest) { r.Options.MaxSteps = 0 }),
			code: api.ErrorCodeInvalidRequest, status: http.StatusBadRequest,
		},
		{
			name: "idempotency key that is not a UUID", s: s, method: http.MethodPost, path: "/visualizations", target: "/api/v1/visualizations",
			body: createBody(t, nil), header: http.Header{"Idempotency-Key": {"twice"}},
			code: api.ErrorCodeInvalidRequest, status: http.StatusBadRequest,
		},
		{
			name: "wait that is not a number", s: s, method: http.MethodGet, path: "/visualizations/{id}", target: "/api/v1/visualizations/viz_00?wait=soon&since=0",
			code: api.ErrorCodeInvalidRequest, status: http.StatusBadRequest,
		},
		{
			name: "wait over 20 seconds", s: s, method: http.MethodGet, path: "/visualizations/{id}", target: "/api/v1/visualizations/viz_00?wait=21&since=0",
			code: api.ErrorCodeInvalidRequest, status: http.StatusBadRequest,
		},
		{
			name: "source over 64 KB", s: s, method: http.MethodPost, path: "/visualizations", target: "/api/v1/visualizations",
			body: createBody(t, func(r *api.CreateVisualizationRequest) { r.Source = strings.Repeat("x", 64<<10+1) }),
			code: api.ErrorCodePayloadTooLarge, status: http.StatusRequestEntityTooLarge,
		},
		{
			name: "body over 1 MB", s: s, method: http.MethodPost, path: "/visualizations", target: "/api/v1/visualizations",
			body: `{"source":"` + strings.Repeat("x", 1<<20) + `"}`,
			code: api.ErrorCodePayloadTooLarge, status: http.StatusRequestEntityTooLarge,
		},
		{
			name: "unknown language", s: s, method: http.MethodPost, path: "/visualizations", target: "/api/v1/visualizations",
			body: createBody(t, func(r *api.CreateVisualizationRequest) { r.Language = "cobol" }),
			code: api.ErrorCodeUnsupportedLanguage, status: http.StatusUnprocessableEntity,
		},
		{
			name: "daily quota used up", s: s, method: http.MethodPost, path: "/visualizations", target: "/api/v1/visualizations",
			body: createBody(t, nil), peer: "198.51.100.9:41000",
			code: api.ErrorCodeRateLimited, status: http.StatusTooManyRequests, retryAfter: "57600",
		},
		{
			name: "queue at its cap", s: full, method: http.MethodPost, path: "/visualizations", target: "/api/v1/visualizations",
			body: createBody(t, nil), code: api.ErrorCodeCapacity, status: http.StatusServiceUnavailable, retryAfter: "5",
		},
		{
			name: "mysql unreachable", s: down, method: http.MethodGet, path: "/visualizations/{id}", target: "/api/v1/visualizations/viz_00",
			code: api.ErrorCodeCapacity, status: http.StatusServiceUnavailable, retryAfter: "5", hidden: "127.0.0.1:1",
		},
		{
			name: "unknown visualization", s: s, method: http.MethodGet, path: "/visualizations/{id}", target: "/api/v1/visualizations/viz_00",
			code: api.ErrorCodeNotFound, status: http.StatusNotFound,
		},
		{
			name: "route the API doesn't have", s: s, method: http.MethodGet, target: "/api/v1/nope",
			code: api.ErrorCodeNotFound, status: http.StatusNotFound,
		},
		{
			name: "share before it is completed", s: s, method: http.MethodPost, path: "/visualizations/{id}/share", target: "/api/v1/visualizations/" + broken.ID + "/share",
			code: api.ErrorCodeInvalidRequest, status: http.StatusBadRequest,
		},
		{
			name: "visualization past its retention", s: s, method: http.MethodGet, path: "/visualizations/{id}", target: "/api/v1/visualizations/" + old.ID,
			code: api.ErrorCodeExpired, status: http.StatusGone,
		},
		{
			name: "bearer token past its exp", s: s, method: http.MethodPost, path: "/visualizations", target: "/api/v1/visualizations",
			body: createBody(t, nil), header: bearer(t, signer, nil, func(c map[string]any) { c["exp"] = day0.Unix() }),
			code: api.ErrorCodeTokenExpired, status: http.StatusUnauthorized,
		},
		{
			name: "bearer token from an unknown key", s: s, method: http.MethodGet, path: "/languages", target: "/api/v1/languages",
			header: bearer(t, signer, func(h map[string]any) { h["kid"] = "k9" }, nil),
			code:   api.ErrorCodeTokenInvalid, status: http.StatusUnauthorized,
		},
		{
			name: "trace row the server cannot read", s: s, method: http.MethodGet, path: "/visualizations/{id}", target: "/api/v1/visualizations/" + broken.ID,
			code: api.ErrorCodeInternalError, status: http.StatusInternalServerError, hidden: brokenTrace,
		},
	}
	covered := map[api.ErrorCode]bool{}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := newRequest(t, tt.method, tt.target, tt.body)
			maps.Copy(r.Header, tt.header)
			if tt.peer != "" {
				r.RemoteAddr = tt.peer
			}
			rec := tt.s.serve(r)

			e := decode[api.ErrorResponse](t, rec).Error
			if rec.Code != tt.status || e.Code != tt.code {
				t.Errorf("got %d %s, want %d %s", rec.Code, e.Code, tt.status, tt.code)
			}
			if id := rec.Header().Get("X-Request-ID"); e.RequestID == "" || e.RequestID != id {
				t.Errorf("requestId %q, X-Request-ID %q; want the same, not empty", e.RequestID, id)
			}
			var retry string
			if e.RetryAfterSec != nil {
				retry = strconv.Itoa(*e.RetryAfterSec)
			}
			if got := rec.Header().Get("Retry-After"); got != tt.retryAfter || retry != tt.retryAfter {
				t.Errorf("Retry-After %q and retryAfterSec %q, want both %q", got, retry, tt.retryAfter)
			}
			if tt.hidden != "" && strings.Contains(rec.Body.String(), tt.hidden) {
				t.Errorf("body shows %q: %s", tt.hidden, rec.Body)
			}
			if tt.path == "" {
				validate(t, loadSpec(t), "/components/schemas/ErrorResponse", rec.Body.Bytes())
			} else {
				checkContract(t, tt.method, tt.path, rec)
			}
		})
		covered[tt.code] = true
	}
	for _, code := range errorCodes(t) {
		if !covered[code] {
			t.Errorf("no case answers with error code %s", code)
		}
	}
}

func TestLanguagesAreCacheableFor5Minutes(t *testing.T) {
	t.Parallel()
	s := newStack(t, newDB(t), 100)

	rec := s.serve(newRequest(t, http.MethodGet, "/api/v1/languages", ""))
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "max-age=300" {
		t.Errorf("got %d with Cache-Control %q, want 200 with max-age=300", rec.Code, rec.Header().Get("Cache-Control"))
	}
	checkContract(t, http.MethodGet, "/languages", rec)
}

func TestCreateAnswers201WithLocationEvenForARepeatedKey(t *testing.T) {
	t.Parallel()
	s := newStack(t, newDB(t), 100)
	post := func() *httptest.ResponseRecorder {
		r := newRequest(t, http.MethodPost, "/api/v1/visualizations", createBody(t, nil))
		r.Header.Set("Idempotency-Key", "0b6f0c4e-2f7c-4a51-9d3e-6c1f2a8b9d40")
		return s.serve(r)
	}

	first := post()
	v := decode[api.Visualization](t, first)
	checkContract(t, http.MethodPost, "/visualizations", first)
	if first.Code != http.StatusCreated || first.Header().Get("Location") != "/api/v1/visualizations/"+v.ID {
		t.Errorf("got %d with Location %q, want 201 with /api/v1/visualizations/%s", first.Code, first.Header().Get("Location"), v.ID)
	}
	read := s.serve(newRequest(t, http.MethodGet, first.Header().Get("Location"), ""))
	if diff := cmp.Diff(first.Body.String(), read.Body.String()); read.Code != http.StatusOK || diff != "" {
		t.Errorf("GET Location: %d (-created +read):\n%s", read.Code, diff)
	}

	repeat := post()
	if again := decode[api.Visualization](t, repeat); repeat.Code != http.StatusCreated || again.ID != v.ID {
		t.Errorf("repeated key: got %d for %s, want 201 for %s", repeat.Code, again.ID, v.ID)
	}
}

func TestGetShowsEachStateAsTheContractSays(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	s := newStack(t, newDB(t), 100)
	tests := []struct {
		name    string
		prepare func(t *testing.T, v api.Visualization, l ports.Lease)
		status  api.VisualizationStatus
	}{
		{
			name: "tracing",
			prepare: func(t *testing.T, _ api.Visualization, l ports.Lease) {
				if err := s.q.Tracing(ctx, l, s.now); err != nil {
					t.Fatal(err)
				}
				if err := s.q.Progress(ctx, l, 412, s.now); err != nil {
					t.Fatal(err)
				}
			},
			status: api.VisualizationStatusTracing,
		},
		{
			name:    "completed",
			prepare: func(t *testing.T, _ api.Visualization, l ports.Lease) { s.complete(t, l) },
			status:  api.VisualizationStatusCompleted,
		},
		{
			name: "failed build",
			prepare: func(t *testing.T, _ api.Visualization, l ports.Lease) {
				if err := s.q.Building(ctx, l, s.now); err != nil {
					t.Fatal(err)
				}
				build := json.RawMessage(`{"ok":false,"durationMs":920,"diagnostics":[{"line":1,"column":7,"severity":"error","message":"invalid syntax"}],"raw":"main.py:1:7: invalid syntax"}`)
				if err := s.q.Fail(ctx, l, api.FailureKindCompileError, build, s.now); err != nil {
					t.Fatal(err)
				}
			},
			status: api.VisualizationStatusFailed,
		},
		{
			name: "deleted",
			prepare: func(t *testing.T, v api.Visualization, _ ports.Lease) {
				rec := s.serve(newRequest(t, http.MethodDelete, "/api/v1/visualizations/"+v.ID, ""))
				if rec.Code != http.StatusNoContent {
					t.Fatalf("delete: got %d, want 204: %s", rec.Code, rec.Body)
				}
				checkContract(t, http.MethodDelete, "/visualizations/{id}", rec)
			},
			status: api.VisualizationStatusCanceled,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v := s.create(t, tt.name)
			job, err := s.q.Claim(ctx, "w1", s.now)
			if err != nil {
				t.Fatal(err)
			}
			tt.prepare(t, v, job.Lease)

			rec := s.serve(newRequest(t, http.MethodGet, "/api/v1/visualizations/"+v.ID, ""))
			got := decode[api.Visualization](t, rec)
			if rec.Code != http.StatusOK || got.Status != tt.status {
				t.Errorf("got %d %s, want 200 %s", rec.Code, got.Status, tt.status)
			}
			checkContract(t, http.MethodGet, "/visualizations/{id}", rec)
			if got.Trace == nil {
				return
			}
			if chunk := fetch(t, got.Trace.Chunks[0].URL); !bytes.Equal(chunk, chunkBody(t)) {
				t.Errorf("signed chunk URL gave %d bytes, want the chunk", len(chunk))
			}
		})
	}
}

func TestShareReShareAndRevokeAsTheContractSays(t *testing.T) {
	t.Parallel()
	s := newStack(t, newDB(t), 100)
	v := s.create(t, "print(1)")
	job, err := s.q.Claim(t.Context(), "w1", s.now)
	if err != nil {
		t.Fatal(err)
	}
	s.complete(t, job.Lease)
	share := "/api/v1/visualizations/" + v.ID + "/share"

	shared := s.serve(newRequest(t, http.MethodPost, share, ""))
	checkContract(t, http.MethodPost, "/visualizations/{id}/share", shared)
	link := decode[api.ShareLink](t, shared)
	id, ok := strings.CutPrefix(link.URL, ide+"/viz/")
	if shared.Code != http.StatusOK || !ok || id == v.ID {
		t.Fatalf("share: got %d with %s, want 200 with a new ID under %s/viz/", shared.Code, link.URL, ide)
	}
	again := s.serve(newRequest(t, http.MethodPost, share, ""))
	if diff := cmp.Diff(shared.Body.String(), again.Body.String()); again.Code != http.StatusOK || diff != "" {
		t.Errorf("share again: %d (-first +again):\n%s", again.Code, diff)
	}

	const other = "198.51.100.7:41000"
	tests := []struct {
		name   string
		peer   string
		method string
		path   string
		target string
		status int
		cache  string
	}{
		{"another caller reads the link", other, http.MethodGet, "/visualizations/{id}", "/api/v1/visualizations/" + id, http.StatusOK, "public, max-age=60"},
		{"the owner reads the visualization", "", http.MethodGet, "/visualizations/{id}", "/api/v1/visualizations/" + v.ID, http.StatusOK, "no-store"},
		{"another caller can't share it", other, http.MethodPost, "/visualizations/{id}/share", share, http.StatusNotFound, ""},
		{"another caller can't revoke it", other, http.MethodDelete, "/visualizations/{id}/share", share, http.StatusNotFound, ""},
		{"the owner revokes it", "", http.MethodDelete, "/visualizations/{id}/share", share, http.StatusNoContent, ""},
		{"the revoked link is gone for another caller", other, http.MethodGet, "/visualizations/{id}", "/api/v1/visualizations/" + id, http.StatusNotFound, ""},
		{"the revoked link is gone for the owner", "", http.MethodGet, "/visualizations/{id}", "/api/v1/visualizations/" + id, http.StatusNotFound, ""},
		{"the owner still reads the visualization", "", http.MethodGet, "/visualizations/{id}", "/api/v1/visualizations/" + v.ID, http.StatusOK, "no-store"},
		{"the owner revokes again", "", http.MethodDelete, "/visualizations/{id}/share", share, http.StatusNoContent, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := newRequest(t, tt.method, tt.target, "")
			if tt.peer != "" {
				r.RemoteAddr = tt.peer
			}
			rec := s.serve(r)

			if rec.Code != tt.status || rec.Header().Get("Cache-Control") != tt.cache {
				t.Errorf("got %d with Cache-Control %q, want %d with %q", rec.Code, rec.Header().Get("Cache-Control"), tt.status, tt.cache)
			}
			checkContract(t, tt.method, tt.path, rec)
		})
	}
}

func TestCallerIsAKeyedHashOfTheClientIPv4OrIPv6Slash64(t *testing.T) {
	t.Parallel()
	s := newStack(t, newDB(t), 100)
	tests := []struct {
		name      string
		peer      string
		forwarded []string
		client    string
	}{
		{"proxied request is the rightmost forwarded hop", "127.0.0.1:41000", []string{"203.0.113.7, 198.51.100.2"}, "198.51.100.2"},
		{"proxied request is the last hop of the last forwarded header", "127.0.0.1:41000", []string{"203.0.113.7", "198.51.100.3"}, "198.51.100.3"},
		{"direct request is its peer despite a forged forwarded header", "192.0.2.10:41000", []string{"198.51.100.2"}, "192.0.2.10"},
		{"request proxied over IPv6 loopback is the /64 of its IPv6 hop", "[::1]:41000", []string{"2001:db8::7"}, "2001:db8::/64"},
		{"direct IPv6 request is its /64 despite a forged forwarded header", "[2001:db8::1]:41000", []string{"198.51.100.2"}, "2001:db8::/64"},
		{"IPv6 request from another /64 is that /64", "[2001:db8:0:1::5]:41000", nil, "2001:db8:0:1::/64"},
		{"IPv4-mapped IPv6 peer is its IPv4 address", "[::ffff:192.0.2.10]:41000", nil, "192.0.2.10"},
		{"local request without a forwarded header is the loopback peer", "127.0.0.1:41000", nil, "127.0.0.1"},
		{"proxied request with an unparsable hop is the /64 of the loopback peer", "[::1]:41000", []string{"unknown"}, "::/64"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := newRequest(t, http.MethodPost, "/api/v1/visualizations", createBody(t, nil))
			r.RemoteAddr = tt.peer
			for _, hop := range tt.forwarded {
				r.Header.Add("X-Forwarded-For", hop)
			}
			rec := s.serve(r)
			if rec.Code != http.StatusCreated {
				t.Fatalf("create: got %d: %s", rec.Code, rec.Body)
			}

			var subject string
			err := s.db.QueryRowContext(t.Context(), "SELECT subject FROM visualizations WHERE id = ?", decode[api.Visualization](t, rec).ID).Scan(&subject)
			if err != nil {
				t.Fatal(err)
			}
			if subject != subjectOf(tt.client) {
				t.Errorf("subject %s, want the keyed hash of %s", subject, tt.client)
			}
		})
	}
}

func TestBearerTokenMakesTheCallerItsSignedInUser(t *testing.T) {
	t.Parallel()
	s := newStack(t, newDB(t), 100)
	long := strings.Repeat("u", 250)
	tests := []struct {
		name   string
		header http.Header
		sub    string
	}{
		{"token names its user", bearer(t, signer, nil, func(c map[string]any) { c["sub"] = "42" }), "42"},
		{"token a second before its exp", bearer(t, signer, nil, func(c map[string]any) { c["sub"], c["exp"] = "43", day0.Unix()+1 }), "43"},
		{"sub of 250 bytes", bearer(t, signer, nil, func(c map[string]any) { c["sub"] = long }), long},
		{"scheme in lowercase", http.Header{"Authorization": {"bearer " + token(t, signer, nil, func(c map[string]any) { c["sub"] = "44" })}}, "44"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := s.db.ExecContext(t.Context(), "INSERT INTO usage_daily (subject, day, count) VALUES (?, ?, 100)", "user:"+tt.sub, domain.QuotaDay(s.now))
			if err != nil {
				t.Fatal(err)
			}
			r := newRequest(t, http.MethodPost, "/api/v1/visualizations", createBody(t, nil))
			r.RemoteAddr = "198.51.100.20:41000"
			maps.Copy(r.Header, tt.header)
			rec := s.serve(r)
			if rec.Code != http.StatusCreated {
				t.Fatalf("create past the anonymous quota: got %d: %s", rec.Code, rec.Body)
			}

			var subject string
			err = s.db.QueryRowContext(t.Context(), "SELECT subject FROM visualizations WHERE id = ?", decode[api.Visualization](t, rec).ID).Scan(&subject)
			if err != nil {
				t.Fatal(err)
			}
			if subject != "user:"+tt.sub {
				t.Errorf("subject %s, want user:%s", subject, tt.sub)
			}
		})
	}
}

func TestBadBearerTokenAnswers401AndRunsNothing(t *testing.T) {
	t.Parallel()
	s := newStack(t, newDB(t), 100)
	other := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{8}, ed25519.SeedSize))
	claims := func(change func(c map[string]any)) http.Header { return bearer(t, signer, nil, change) }
	good := token(t, signer, nil, nil)
	tests := []struct {
		name   string
		header http.Header
		code   api.ErrorCode
	}{
		{"exp is now", claims(func(c map[string]any) { c["exp"] = day0.Unix() }), api.ErrorCodeTokenExpired},
		{"exp an hour ago", claims(func(c map[string]any) { c["exp"] = day0.Add(-time.Hour).Unix() }), api.ErrorCodeTokenExpired},
		{"another audience", claims(func(c map[string]any) { c["aud"] = "judge" }), api.ErrorCodeTokenInvalid},
		{"another issuer", claims(func(c map[string]any) { c["iss"] = "evil" }), api.ErrorCodeTokenInvalid},
		{"no sub", claims(func(c map[string]any) { delete(c, "sub") }), api.ErrorCodeTokenInvalid},
		{"sub over 250 bytes", claims(func(c map[string]any) { c["sub"] = strings.Repeat("u", 251) }), api.ErrorCodeTokenInvalid},
		{"no exp", claims(func(c map[string]any) { delete(c, "exp") }), api.ErrorCodeTokenInvalid},
		{"unknown kid", bearer(t, signer, func(h map[string]any) { h["kid"] = "k9" }, nil), api.ErrorCodeTokenInvalid},
		{"signed by another key", bearer(t, other, nil, nil), api.ErrorCodeTokenInvalid},
		{"alg other than EdDSA", bearer(t, signer, func(h map[string]any) { h["alg"] = "none" }, nil), api.ErrorCodeTokenInvalid},
		{"signature cut short", http.Header{"Authorization": {"Bearer " + good[:len(good)-4]}}, api.ErrorCodeTokenInvalid},
		{"not a JWT", http.Header{"Authorization": {"Bearer abc"}}, api.ErrorCodeTokenInvalid},
		{"basic credentials", http.Header{"Authorization": {"Basic dTpw"}}, api.ErrorCodeTokenInvalid},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := newRequest(t, http.MethodPost, "/api/v1/visualizations", createBody(t, nil))
			maps.Copy(r.Header, tt.header)
			rec := s.serve(r)

			if e := decode[api.ErrorResponse](t, rec).Error; rec.Code != http.StatusUnauthorized || e.Code != tt.code {
				t.Errorf("got %d %s, want 401 %s", rec.Code, e.Code, tt.code)
			}
			if got := rec.Header().Get("WWW-Authenticate"); got != `Bearer error="invalid_token"` {
				t.Errorf("WWW-Authenticate %q", got)
			}
		})
	}
	var n int
	if err := s.db.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM visualizations").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d visualizations created with a bad token, want 0", n)
	}
}

func TestRequestIDComesFromTheProxyOrIsGenerated(t *testing.T) {
	t.Parallel()
	s := newStack(t, newDB(t), 100)
	generated := regexp.MustCompile(`^req_[0-9a-f]{16}$`)
	tests := []struct {
		name string
		peer string
		sent string
		want string
	}{
		{"proxy's ID is kept", "127.0.0.1:41000", "4f1c-9a2e", "4f1c-9a2e"},
		{"proxy's ID over IPv6 loopback is kept", "[::1]:41000", "4f1c-9a2f", "4f1c-9a2f"},
		{"direct caller's ID is replaced", "192.0.2.10:41000", "forged", ""},
		{"direct IPv6 caller's ID is replaced", "[2001:db8::1]:41000", "forged", ""},
		{"request without an ID gets one", "127.0.0.1:41000", "", ""},
		{"proxy's ID with a space is replaced", "127.0.0.1:41000", "a b", ""},
		{"proxy's ID over 64 characters is replaced", "127.0.0.1:41000", strings.Repeat("a", 65), ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := newRequest(t, http.MethodGet, "/api/v1/nope", "")
			r.RemoteAddr = tt.peer
			if tt.sent != "" {
				r.Header.Set("X-Request-ID", tt.sent)
			}
			rec := s.serve(r)

			id := rec.Header().Get("X-Request-ID")
			if body := decode[api.ErrorResponse](t, rec).Error.RequestID; body != id {
				t.Errorf("requestId %q, X-Request-ID %q; want the same", body, id)
			}
			if tt.want != "" && id != tt.want {
				t.Errorf("request ID %q, want %q", id, tt.want)
			}
			if tt.want == "" && (!generated.MatchString(id) || id == tt.sent) {
				t.Errorf("request ID %q, want a fresh req_ and 16 hex digits", id)
			}
		})
	}
}

func TestRequestsAreTimedByRoutePatternAndStatus(t *testing.T) {
	t.Parallel()
	s := newStack(t, newDB(t), 100)
	for _, path := range []string{"/api/v1/languages", "/api/v1/languages", "/api/v1/visualizations/viz_00", "/api/v1/nope"} {
		s.serve(newRequest(t, http.MethodGet, path, ""))
	}

	families, err := s.reg.Gather()
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]uint64{}
	for _, f := range families {
		for _, m := range f.GetMetric() {
			labels := map[string]string{}
			for _, l := range m.GetLabel() {
				labels[l.GetName()] = l.GetValue()
			}
			got[f.GetName()+" "+labels["route"]+" "+labels["status"]] = m.GetHistogram().GetSampleCount()
		}
	}
	want := map[string]uint64{
		"vizd_http_request_duration_seconds GET /api/v1/languages 200":           2,
		"vizd_http_request_duration_seconds GET /api/v1/visualizations/{id} 404": 1,
		"vizd_http_request_duration_seconds /api/v1/ 404":                        1,
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("requests timed (-want +got):\n%s", diff)
	}
}

func TestCORSAllowsOnlyTheIDEOrigins(t *testing.T) {
	t.Parallel()
	s := newStack(t, newDB(t), 100)
	preflight := func(origin string) *http.Request {
		r := newRequest(t, http.MethodOptions, "/api/v1/visualizations", "")
		r.Header.Set("Origin", origin)
		r.Header.Set("Access-Control-Request-Method", http.MethodPost)
		r.Header.Set("Access-Control-Request-Headers", "content-type,idempotency-key")
		return r
	}
	get := func(origin string) *http.Request {
		r := newRequest(t, http.MethodGet, "/api/v1/languages", "")
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		return r
	}
	tests := []struct {
		name    string
		req     *http.Request
		status  int
		headers map[string]string
	}{
		{"preflight from the IDE", preflight(ide), http.StatusNoContent, map[string]string{
			"Access-Control-Allow-Origin":  ide,
			"Access-Control-Allow-Methods": "GET, POST, DELETE",
			"Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
			"Vary":                         "Origin",
		}},
		{"preflight from another origin", preflight("https://evil.example"), http.StatusNotFound, map[string]string{"Vary": "Origin"}},
		{"request from the IDE", get(ide), http.StatusOK, map[string]string{
			"Access-Control-Allow-Origin":   ide,
			"Access-Control-Expose-Headers": "Location, Retry-After, X-Request-ID",
			"Vary":                          "Origin",
		}},
		{"request from another origin", get("https://evil.example"), http.StatusOK, map[string]string{"Vary": "Origin"}},
		{"request without an origin", get(""), http.StatusOK, map[string]string{"Vary": "Origin"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := s.serve(tt.req)
			got := map[string]string{}
			for _, h := range []string{"Access-Control-Allow-Origin", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers", "Access-Control-Expose-Headers", "Vary"} {
				if v := rec.Header().Get(h); v != "" {
					got[h] = v
				}
			}
			if rec.Code != tt.status {
				t.Errorf("got %d, want %d", rec.Code, tt.status)
			}
			if diff := cmp.Diff(tt.headers, got); diff != "" {
				t.Errorf("CORS headers (-want +got):\n%s", diff)
			}
		})
	}
}

func TestParkedGetReturnsItsCurrentStateOnceThePollerStops(t *testing.T) {
	t.Parallel()
	s := newStack(t, newDB(t), 100)
	asked := make(chan struct{}, 1)
	poller := mysql.NewPoller(s.db, time.Now, func(time.Duration) <-chan time.Time {
		select {
		case asked <- struct{}{}:
		default:
		}
		return nil
	})
	s.viz.Events = poller
	ctx, stop := context.WithCancel(t.Context())
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		poller.Run(ctx)
	}()
	t.Cleanup(func() {
		stop()
		<-stopped
	})
	v := s.create(t, "print(1)")

	answered := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		answered <- s.serve(newRequest(t, http.MethodGet, "/api/v1/visualizations/"+v.ID+"?wait=20&since=0", ""))
	}()
	select {
	case <-asked:
	case <-time.After(time.Minute):
		t.Fatal("GET did not park within a minute")
	}
	job, err := s.q.Claim(t.Context(), "w1", s.now)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.q.Building(t.Context(), job.Lease, s.now); err != nil {
		t.Fatal(err)
	}
	stop()

	select {
	case rec := <-answered:
		got := decode[api.Visualization](t, rec)
		if rec.Code != http.StatusOK || got.Status != api.VisualizationStatusBuilding || got.Version != 1 {
			t.Errorf("got %d %s at version %d, want 200 building at version 1", rec.Code, got.Status, got.Version)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("parked GET still waits 10 s after the poller stopped")
	}
}

func TestOnlyServerErrorsAreLoggedOnceWithTheirRequestID(t *testing.T) {
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	s := newStack(t, newDB(t), 100)
	v := s.create(t, "print(1)")
	broken := s.create(t, "broken")
	if _, err := s.db.ExecContext(t.Context(), `UPDATE traces SET build = '{"ok": "yes"}' WHERE id = ?`, traceOf(t, s.db, broken.ID)); err != nil {
		t.Fatal(err)
	}
	gone, hangUp := context.WithCancel(t.Context())
	hangUp()

	tests := []struct {
		name string
		req  *http.Request
		want []string
	}{
		{"server error is logged once", newRequest(t, http.MethodGet, "/api/v1/visualizations/"+broken.ID, ""), []string{"ERROR request failed"}},
		{"client error is not logged", newRequest(t, http.MethodGet, "/api/v1/visualizations/viz_00", ""), nil},
		{"request whose client hung up is not logged", newRequest(t, http.MethodGet, "/api/v1/visualizations/"+v.ID, "").WithContext(gone), nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id := s.serve(tt.req).Header().Get("X-Request-ID")
			var got []string
			lines := bufio.NewScanner(bytes.NewReader(logs.Bytes()))
			for lines.Scan() {
				var record struct {
					Level     string `json:"level"`
					Msg       string `json:"msg"`
					RequestID string `json:"request_id"`
				}
				if err := json.Unmarshal(lines.Bytes(), &record); err != nil {
					t.Fatal(err)
				}
				if record.RequestID == id {
					got = append(got, record.Level+" "+record.Msg)
				}
			}
			if diff := cmp.Diff(tt.want, got); diff != "" {
				t.Errorf("log records of request %s (-want +got):\n%s", id, diff)
			}
		})
	}
}

type stack struct {
	db  *sql.DB
	q   *mysql.Queue
	viz *app.Visualizations
	h   http.Handler
	reg *prometheus.Registry
	now time.Time
}

func newStack(t *testing.T, db *sql.DB, maxQueued int) *stack {
	t.Helper()
	adapters, err := manifest.Load("../../../adapters")
	if err != nil {
		t.Fatal(err)
	}
	s := &stack{db: db, q: mysql.NewQueue(db), reg: prometheus.NewRegistry(), now: day0}
	s.viz = &app.Visualizations{
		Store:     mysql.NewStore(db, maxQueued),
		Adapters:  adapters,
		Blobs:     newBucket(t),
		Events:    mysql.NewPoller(db, time.Now, time.After),
		Now:       func() time.Time { return s.now },
		Random:    rand.Reader,
		WebOrigin: ide,
	}
	mux := http.NewServeMux()
	httptransport.HandleAPI(mux, s.viz, ipKey, issuer, []string{ide}, s.reg)
	s.h = mux
	return s
}

func (s *stack) serve(r *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	s.h.ServeHTTP(rec, r)
	return rec
}

func (s *stack) create(t *testing.T, source string) api.Visualization {
	t.Helper()
	body := createBody(t, func(r *api.CreateVisualizationRequest) { r.Source = source })
	rec := s.serve(newRequest(t, http.MethodPost, "/api/v1/visualizations", body))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: got %d: %s", rec.Code, rec.Body)
	}
	return decode[api.Visualization](t, rec)
}

func (s *stack) complete(t *testing.T, l ports.Lease) {
	t.Helper()
	ctx := t.Context()
	if err := s.q.Tracing(ctx, l, s.now); err != nil {
		t.Fatal(err)
	}
	if err := s.viz.Blobs.Put(ctx, domain.ChunkKey("t7", l.TraceID, 0), "application/json", chunkBody(t)); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(chunkBody(t))
	header := `{"version":"1.0","id":"` + l.TraceID + `",` +
		`"language":{"id":"python3","runtime":"Python 3.12","adapter":"python-settrace/1"},"source":{"file":"main.py","lineCount":1},` +
		`"options":{"maxSteps":1000,"startAtLines":[]},` +
		`"summary":{"stepCount":3,"truncated":false,"truncation":null,"exit":{"kind":"normal","code":0,"signal":null,"message":null}},` +
		`"encoding":{"mode":"delta","keyframeInterval":50}}`
	err := s.q.Complete(ctx, l, ports.CompletedTrace{
		Header:        json.RawMessage(header),
		Chunks:        []ports.Chunk{{Index: 0, FromStep: 0, ToStep: 2, SizeBytes: len(chunkBody(t)), SHA256: hex.EncodeToString(sum[:])}},
		ExitKind:      trace.ExitKindNormal,
		StoragePrefix: "t7",
		Build:         json.RawMessage(`{"ok":true,"durationMs":40,"diagnostics":[]}`),
	}, s.now)
	if err != nil {
		t.Fatal(err)
	}
}

func newRequest(t *testing.T, method, target, body string) *http.Request {
	t.Helper()
	r := httptest.NewRequestWithContext(t.Context(), method, target, strings.NewReader(body))
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	return r
}

func createBody(t *testing.T, change func(r *api.CreateVisualizationRequest)) string {
	t.Helper()
	r := api.CreateVisualizationRequest{
		Language: "python3",
		Source:   "print(1)",
		Options:  trace.Options{MaxSteps: 1000, StartAtLines: []int{}},
		Context:  api.ClientContext{Client: "test"},
	}
	if change != nil {
		change(&r)
	}
	b, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %d response %q: %v", rec.Code, rec.Body, err)
	}
	return v
}

func token(t *testing.T, key ed25519.PrivateKey, changeHeader, changeClaims func(map[string]any)) string {
	t.Helper()
	header := map[string]any{"alg": "EdDSA", "typ": "JWT", "kid": "k1"}
	claims := map[string]any{"iss": "amoj", "aud": "viz", "sub": "42", "iat": day0.Unix(), "exp": day0.Add(15 * time.Minute).Unix()}
	if changeHeader != nil {
		changeHeader(header)
	}
	if changeClaims != nil {
		changeClaims(claims)
	}
	var segs []string
	for _, v := range []map[string]any{header, claims} {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		segs = append(segs, base64.RawURLEncoding.EncodeToString(b))
	}
	signed := strings.Join(segs, ".")
	return signed + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, []byte(signed)))
}

func bearer(t *testing.T, key ed25519.PrivateKey, changeHeader, changeClaims func(map[string]any)) http.Header {
	t.Helper()
	return http.Header{"Authorization": {"Bearer " + token(t, key, changeHeader, changeClaims)}}
}

func subjectOf(ip string) string {
	mac := hmac.New(sha256.New, ipKey)
	mac.Write([]byte(ip))
	return "ip:" + hex.EncodeToString(mac.Sum(nil))
}

func traceOf(t *testing.T, db *sql.DB, vizID string) string {
	t.Helper()
	var id string
	if err := db.QueryRowContext(t.Context(), "SELECT trace_id FROM visualizations WHERE id = ?", vizID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func chunkBody(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write([]byte(`[{"line":1},{"line":2},{"line":3}]`)); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func fetch(t *testing.T, url string) []byte {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Accept-Encoding", "identity")
	resp, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET signed chunk URL: HTTP %d: %s", resp.StatusCode, body)
	}
	return body
}

func checkContract(t *testing.T, method, path string, rec *httptest.ResponseRecorder) {
	t.Helper()
	doc := loadSpec(t)
	resp, ptr, ok := deref(t, doc, "/paths/"+escape(path)+"/"+strings.ToLower(method)+"/responses/"+strconv.Itoa(rec.Code))
	if !ok {
		t.Errorf("spec has no %d for %s %s", rec.Code, method, path)
		return
	}
	headers, _ := resp["headers"].(map[string]any)
	for name := range headers {
		h, _, _ := deref(t, doc, ptr+"/headers/"+escape(name))
		if h["required"] == true && rec.Header().Get(name) == "" {
			t.Errorf("%s %s %d has no %s header", method, path, rec.Code, name)
		}
	}
	if _, ok := resp["content"]; !ok {
		if rec.Body.Len() > 0 {
			t.Errorf("%s %s %d has a body, the spec gives it none: %s", method, path, rec.Code, rec.Body)
		}
		return
	}
	validate(t, doc, ptr+"/content/application~1json/schema", rec.Body.Bytes())
}

func validate(t *testing.T, doc any, ptr string, body []byte) {
	t.Helper()
	c := jsonschema.NewCompiler()
	c.AssertFormat()
	if err := c.AddResource(spec, doc); err != nil {
		t.Fatal(err)
	}
	sch, err := c.Compile(spec + "#" + ptr)
	if err != nil {
		t.Fatal(err)
	}
	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("decode body %q: %v", body, err)
	}
	if err := sch.Validate(inst); err != nil {
		t.Errorf("body breaks the API contract: %v\n%s", err, body)
	}
}

func errorCodes(t *testing.T) []api.ErrorCode {
	t.Helper()
	enum, ok := lookup(loadSpec(t), "/components/schemas/Error/properties/code/enum")
	if !ok {
		t.Fatal("spec has no error code enum")
	}
	var codes []api.ErrorCode
	for _, c := range enum.([]any) {
		codes = append(codes, api.ErrorCode(c.(string)))
	}
	return codes
}

func deref(t *testing.T, doc any, ptr string) (map[string]any, string, bool) {
	t.Helper()
	node, ok := lookup(doc, ptr)
	if !ok {
		return nil, "", false
	}
	obj := node.(map[string]any)
	if ref, ok := obj["$ref"].(string); ok {
		ptr = strings.TrimPrefix(ref, "#")
		if node, ok = lookup(doc, ptr); !ok {
			t.Fatalf("spec has no %s", ref)
		}
		obj = node.(map[string]any)
	}
	return obj, ptr, true
}

func lookup(doc any, ptr string) (any, bool) {
	node := doc
	for _, token := range strings.Split(ptr, "/")[1:] {
		obj, ok := node.(map[string]any)
		if !ok {
			return nil, false
		}
		if node, ok = obj[strings.ReplaceAll(strings.ReplaceAll(token, "~1", "/"), "~0", "~")]; !ok {
			return nil, false
		}
	}
	return node, true
}

func escape(key string) string {
	return strings.ReplaceAll(strings.ReplaceAll(key, "~", "~0"), "/", "~1")
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
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(js))
	if err != nil {
		t.Fatal(err)
	}
	return doc
}
