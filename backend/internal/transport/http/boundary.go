package http

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/netip"
	"regexp"
	"slices"
	"strings"

	"github.com/tu-hm/code-viz/backend/internal/app"
)

type reqInfoKey struct{}

type reqInfo struct {
	id     string
	caller app.Caller
}

func info(ctx context.Context) reqInfo {
	r, _ := ctx.Value(reqInfoKey{}).(reqInfo)
	return r
}

func boundary(ipKey []byte, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := requestID(r)
		w.Header().Set("X-Request-ID", id)
		caller := app.Caller{Subject: subject(ipKey, clientIP(r))}

		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), reqInfoKey{}, reqInfo{id: id, caller: caller})))
	})
}

// proxy passes client's own X-Request-ID through => bound what gets logged and echoed
var safeRequestID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

func requestID(r *http.Request) string {
	if id := r.Header.Get("X-Request-ID"); fromProxy(r) && safeRequestID.MatchString(id) {
		return id
	}
	b := make([]byte, 8)
	rand.Read(b)
	return "req_" + hex.EncodeToString(b)
}

// proxied => rightmost X-Forwarded-For hop, the one proxy appended; anyone else can forge header => TCP peer
func clientIP(r *http.Request) netip.Addr {
	hops := r.Header.Values("X-Forwarded-For")
	if !fromProxy(r) || len(hops) == 0 {
		return peer(r)
	}
	last := strings.Split(hops[len(hops)-1], ",")
	ip, err := netip.ParseAddr(strings.TrimSpace(last[len(last)-1]))
	if err != nil {
		return peer(r)
	}
	return ip
}

// one home or phone gets a whole IPv6 /64 => hash the /64, or rotating addresses dodges the quota
func subject(key []byte, ip netip.Addr) string {
	ip = ip.Unmap()
	s := ip.String()
	if ip.Is6() {
		s = netip.PrefixFrom(ip, 64).Masked().String()
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(s))
	return "ip:" + hex.EncodeToString(mac.Sum(nil))
}

// reverse proxy runs on this host (BE-13 §5)
func fromProxy(r *http.Request) bool {
	return peer(r).IsLoopback()
}

func peer(r *http.Request) netip.Addr {
	ap, err := netip.ParseAddrPort(r.RemoteAddr)
	if err != nil {
		return netip.Addr{}
	}
	return ap.Addr()
}

func cors(origins []string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Add("Vary", "Origin")
		origin := r.Header.Get("Origin")
		if origin == "" || !slices.Contains(origins, origin) {
			next.ServeHTTP(w, r)
			return
		}

		h.Set("Access-Control-Allow-Origin", origin)
		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			h.Set("Access-Control-Allow-Methods", "GET, POST, DELETE")
			h.Set("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.Set("Access-Control-Expose-Headers", "Location, Retry-After, X-Request-ID")
		next.ServeHTTP(w, r)
	})
}
