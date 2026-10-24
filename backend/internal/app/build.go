// Package app holds the use cases behind vizd and vizctl (§7.4).
package app

import (
	"context"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

const maxBuildOutput = 64 << 10

// gcc's format, which tracer.py --check prints too: main.py:3:5: error: invalid syntax
var diagnostic = regexp.MustCompile(`^(\d+):(\d+): (error|warning): (.*)$`)

// Build runs m's build step in box under m.Build.Timeout (§10.2), with m.Build.SafetyFlags unless opts switch them off,
// and returns it as the API shows it, with the failure kind when it failed. The error is for a sandbox failure, never for a failed build.
func Build(ctx context.Context, box ports.Box, m domain.Manifest, opts trace.Options) (api.Build, api.FailureKind, error) {
	ctx, cancel := context.WithTimeout(ctx, m.Build.Timeout)
	defer cancel()
	args := m.Build.Cmd
	if domain.SafetyChecks(opts) {
		args = slices.Concat(m.Build.Cmd, m.Build.SafetyFlags)
	}
	out := &capped{max: maxBuildOutput}
	start := time.Now()
	exit, err := box.Run(ctx, ports.Command{
		Args:   args,
		Env:    append([]string{"VIZ_MODULES_ALLOW=" + strings.Join(m.AllowedModules, ",")}, m.Build.Env...),
		Stdout: out,
		Stderr: out,
		Wire:   io.Discard,
	})
	if err != nil {
		return api.Build{}, "", fmt.Errorf("run build: %w", err)
	}

	b := api.Build{
		Ok:          exit == (ports.Exit{}),
		DurationMs:  int(time.Since(start).Milliseconds()),
		Diagnostics: diagnostics(m.SourceFile, string(out.buf)),
	}
	raw, kind := string(out.buf), api.FailureKindCompileError
	switch {
	case b.Ok:
		kind = ""
	case exit.Limit == ports.LimitTime:
		raw = "Build timed out"
	case exit.Code != 0 && exit.Code == m.Build.UnsupportedModuleExit:
		kind = api.FailureKindUnsupportedModule
	}
	if raw != "" {
		b.Raw = &raw
	}
	return b, kind, nil
}

func diagnostics(file, out string) []api.Diagnostic {
	ds := []api.Diagnostic{}
	for line := range strings.Lines(out) {
		rest, ok := strings.CutPrefix(strings.TrimRight(line, "\r\n"), file+":")
		if !ok {
			continue
		}
		m := diagnostic.FindStringSubmatch(rest)
		if m == nil {
			continue
		}
		l, lerr := strconv.Atoi(m[1])
		c, cerr := strconv.Atoi(m[2])
		if lerr != nil || cerr != nil || l < 1 || c < 1 {
			continue
		}
		ds = append(ds, api.Diagnostic{Line: l, Column: c, Severity: api.DiagnosticSeverity(m[3]), Message: m[4]})
	}
	return ds
}

type capped struct {
	buf []byte
	max int
}

func (c *capped) Write(p []byte) (int, error) {
	room := max(c.max-len(c.buf), 0)
	c.buf = append(c.buf, p[:min(room, len(p))]...)
	return len(p), nil
}
