package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"mime"
	"net/http"
	"strconv"

	"github.com/prometheus/client_golang/prometheus"

	"github.com/tu-hm/code-viz/backend/internal/app"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
)

const (
	basePath = "/api/v1"
	maxBody  = 1 << 20 // 64 KB source + 64 KB stdin at worst-case 6× JSON escaping (\u00XX) = 768 KB; rest for options
)

// HandleAPI registers the visualization API (§8) under /api/v1 on mux, and its metrics with reg. ipKey keys the hash that
// stands for a caller's IP; origins are the browser origins allowed to call the API.
func HandleAPI(mux *http.ServeMux, viz *app.Visualizations, ipKey []byte, origins []string, reg prometheus.Registerer) {
	routes := http.NewServeMux()
	routes.HandleFunc(basePath+"/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, r, fmt.Errorf("no route %s %s: %w", r.Method, r.URL.Path, domain.ErrNotFound))
	})
	strict := api.NewStrictHandlerWithOptions(&server{viz: viz}, []api.StrictMiddlewareFunc{jsonOnly}, api.StrictHTTPServerOptions{
		RequestErrorHandlerFunc:  writeBodyError,
		ResponseErrorHandlerFunc: writeError,
	})
	api.HandlerWithOptions(strict, api.StdHTTPServerOptions{
		BaseURL:          basePath,
		BaseRouter:       routes,
		ErrorHandlerFunc: writeParamError,
	})
	mux.Handle(basePath+"/", boundary(ipKey, cors(origins, observe(newRequestDurations(reg), routes))))
}

// text/plain POST skips the CORS preflight => a foreign page could spend its visitor's quota
func jsonOnly(next api.StrictHandlerFunc, _ string) api.StrictHandlerFunc {
	return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request any) (any, error) {
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if r.ContentLength != 0 && (err != nil || mediaType != "application/json") {
			return nil, fmt.Errorf("the request body must be application/json: %w", domain.ErrInvalidRequest)
		}
		return next(ctx, w, r, request)
	}
}

type server struct {
	viz *app.Visualizations
}

func (s *server) ListLanguages(context.Context, api.ListLanguagesRequestObject) (api.ListLanguagesResponseObject, error) {
	return api.ListLanguages200JSONResponse{
		Body:    app.Languages(s.viz.Adapters),
		Headers: api.ListLanguages200ResponseHeaders{CacheControl: "max-age=300"},
	}, nil
}

func (s *server) CreateVisualization(ctx context.Context, req api.CreateVisualizationRequestObject) (api.CreateVisualizationResponseObject, error) {
	var key string
	if req.Params.IdempotencyKey != nil {
		key = req.Params.IdempotencyKey.String()
	}
	v, err := s.viz.Create(ctx, info(ctx).caller, key, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.CreateVisualization201JSONResponse{
		Body:    v,
		Headers: api.CreateVisualization201ResponseHeaders{Location: basePath + "/visualizations/" + v.ID},
	}, nil
}

func (s *server) GetVisualization(ctx context.Context, req api.GetVisualizationRequestObject) (api.GetVisualizationResponseObject, error) {
	v, shared, err := s.viz.Get(ctx, req.ID, req.Params)
	if err != nil {
		return nil, err
	}
	cache := "no-store"
	if shared {
		cache = "public, max-age=60" // §7.8: a share link that goes viral
	}
	return api.GetVisualization200JSONResponse{Body: v, Headers: api.GetVisualization200ResponseHeaders{CacheControl: cache}}, nil
}

func (s *server) DeleteVisualization(ctx context.Context, req api.DeleteVisualizationRequestObject) (api.DeleteVisualizationResponseObject, error) {
	if err := s.viz.Delete(ctx, info(ctx).caller, req.ID); err != nil {
		return nil, err
	}
	return api.DeleteVisualization204Response{}, nil
}

func (s *server) ShareVisualization(ctx context.Context, req api.ShareVisualizationRequestObject) (api.ShareVisualizationResponseObject, error) {
	link, err := s.viz.Share(ctx, info(ctx).caller, req.ID)
	if err != nil {
		return nil, err
	}
	return api.ShareVisualization200JSONResponse(link), nil
}

func (s *server) RevokeShare(ctx context.Context, req api.RevokeShareRequestObject) (api.RevokeShareResponseObject, error) {
	if err := s.viz.Unshare(ctx, info(ctx).caller, req.ID); err != nil {
		return nil, err
	}
	return api.RevokeShare204Response{}, nil
}

var errorStatuses = []struct {
	err     error
	status  int
	code    api.ErrorCode
	message string // "": the error's own text, written for the caller
}{
	{domain.ErrInvalidRequest, http.StatusBadRequest, api.ErrorCodeInvalidRequest, ""},
	{domain.ErrPayloadTooLarge, http.StatusRequestEntityTooLarge, api.ErrorCodePayloadTooLarge, ""},
	{domain.ErrUnsupportedLanguage, http.StatusUnprocessableEntity, api.ErrorCodeUnsupportedLanguage, ""},
	{domain.ErrQuotaExceeded, http.StatusTooManyRequests, api.ErrorCodeRateLimited, "Daily quota used up. Try again after midnight UTC."},
	{domain.ErrCapacity, http.StatusServiceUnavailable, api.ErrorCodeCapacity, "Visualizer is busy, try again in a few seconds."},
	{domain.ErrInfra, http.StatusServiceUnavailable, api.ErrorCodeCapacity, "Visualizer is busy, try again in a few seconds."},
	{domain.ErrNotFound, http.StatusNotFound, api.ErrorCodeNotFound, "Not found."},
	{domain.ErrExpired, http.StatusGone, api.ErrorCodeExpired, "This visualization has expired."},
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	ctx := r.Context()
	if ctx.Err() != nil { // net/http cancels ctx once client hangs up => no one reads an answer
		return
	}
	e := api.Error{Code: api.ErrorCodeInternalError, Message: "Something went wrong on our side.", RequestID: info(ctx).id}
	status := http.StatusInternalServerError
	for _, s := range errorStatuses {
		if !errors.Is(err, s.err) {
			continue
		}
		status, e.Code, e.Message = s.status, s.code, s.message
		if s.message == "" {
			e.Message = err.Error()
		}
		break
	}

	if status == http.StatusTooManyRequests || status == http.StatusServiceUnavailable {
		after := domain.CapacityRetryAfter
		var retry *domain.RetryError
		if errors.As(err, &retry) {
			after = retry.After
		}
		sec := int(math.Ceil(after.Seconds()))
		e.RetryAfterSec = &sec
		w.Header().Set("Retry-After", strconv.Itoa(sec))
	}
	if status >= http.StatusInternalServerError {
		slog.ErrorContext(ctx, "request failed", "request_id", e.RequestID, "route", r.Pattern, "status", status, "err", err)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(api.ErrorResponse{Error: e}); err != nil {
		slog.WarnContext(ctx, "write error response", "request_id", e.RequestID, "err", err)
	}
}

func writeBodyError(w http.ResponseWriter, r *http.Request, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeError(w, r, fmt.Errorf("request body is over %d KB: %w", tooLarge.Limit>>10, domain.ErrPayloadTooLarge))
		return
	}
	writeError(w, r, fmt.Errorf("request body is not a JSON create request: %w", domain.ErrInvalidRequest))
}

func writeParamError(w http.ResponseWriter, r *http.Request, _ error) {
	writeError(w, r, fmt.Errorf("a query or header parameter is malformed: %w", domain.ErrInvalidRequest))
}
