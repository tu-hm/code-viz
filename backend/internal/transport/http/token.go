package http

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/tu-hm/code-viz/backend/internal/app"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
)

// Issuer is the embedding site whose signed-in users the API accepts: its backend signs a JWT that names the user (§8).
type Issuer struct {
	Name string
	Keys map[string]ed25519.PublicKey // by kid
}

const audience = "viz"

// subject is VARCHAR(255), less the "user:" prefix
const maxSub = 250

// bad token => 401, never anonymous: embedded user would fall back to proxy's shared ip: identity (§12)
func authenticate(iss Issuer, now func() time.Time) api.StrictMiddlewareFunc {
	return func(next api.StrictHandlerFunc, _ string) api.StrictHandlerFunc {
		return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request any) (any, error) {
			header := r.Header.Get("Authorization")
			if header == "" {
				return next(ctx, w, r, request)
			}
			scheme, token, _ := strings.Cut(header, " ")
			if !strings.EqualFold(scheme, "Bearer") {
				return nil, fmt.Errorf("authorization is not a bearer token: %w", domain.ErrTokenInvalid)
			}
			sub, err := iss.verify(token, now())
			if err != nil {
				return nil, err
			}

			ri := info(ctx)
			ri.caller = app.Caller{Subject: "user:" + sub, SignedIn: true}
			ctx = context.WithValue(ctx, reqInfoKey{}, ri)
			return next(ctx, w, r.WithContext(ctx), request)
		}
	}
}

func (iss Issuer) verify(token string, now time.Time) (sub string, err error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("token is not a JWT: %w", domain.ErrTokenInvalid)
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := decodeSegment(parts[0], &header); err != nil {
		return "", fmt.Errorf("token header: %w", err)
	}
	if header.Alg != "EdDSA" {
		return "", fmt.Errorf("token alg %q is not EdDSA: %w", header.Alg, domain.ErrTokenInvalid)
	}
	key, ok := iss.Keys[header.Kid]
	if !ok {
		return "", fmt.Errorf("no key has kid %q: %w", header.Kid, domain.ErrTokenInvalid)
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !ed25519.Verify(key, []byte(parts[0]+"."+parts[1]), sig) {
		return "", fmt.Errorf("token signature does not match kid %q: %w", header.Kid, domain.ErrTokenInvalid)
	}

	var claims struct {
		Iss string `json:"iss"`
		Aud string `json:"aud"`
		Sub string `json:"sub"`
		Exp int64  `json:"exp"`
	}
	if err := decodeSegment(parts[1], &claims); err != nil {
		return "", fmt.Errorf("token claims: %w", err)
	}
	if claims.Iss != iss.Name || claims.Aud != audience {
		return "", fmt.Errorf("token is for %q from %q, want %q from %q: %w", claims.Aud, claims.Iss, audience, iss.Name, domain.ErrTokenInvalid)
	}
	if claims.Sub == "" || len(claims.Sub) > maxSub || claims.Exp == 0 {
		return "", fmt.Errorf("token needs a sub of 1 to %d bytes and an exp: %w", maxSub, domain.ErrTokenInvalid)
	}
	if !now.Before(time.Unix(claims.Exp, 0)) {
		return "", fmt.Errorf("token expired at %d: %w", claims.Exp, domain.ErrTokenExpired)
	}
	return claims.Sub, nil
}

func decodeSegment(seg string, v any) error {
	b, err := base64.RawURLEncoding.DecodeString(seg)
	if err != nil {
		return fmt.Errorf("not base64url: %w", domain.ErrTokenInvalid)
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("not a JSON object of the expected claims: %w", domain.ErrTokenInvalid)
	}
	return nil
}
