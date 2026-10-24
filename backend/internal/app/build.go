// Package app holds the use cases behind vizd and vizctl (§7.4).
package app

import (
	"cmp"
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
var diagnostic = regexp.MustCompile(`^(.+?):(\d+):(\d+): (error|fatal error|warning|note): (.*)$`)

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
	f := regexp.QuoteMeta(file)
	// main.cpp:12:20:   required from here; In file included from main.cpp:1:
	contextAt := regexp.MustCompile(`(?:^|from )` + f + `:(\d+):(?:(\d+):)?`)
	// ld, no column: /work/main.cpp:7: undefined reference to `solve(int)'
	undefinedRef := regexp.MustCompile(`(?:^|/)` + f + `:(\d+): (undefined reference to .*)$`)

	ds := []api.Diagnostic{}
	add := func(line, column, severity, msg string) {
		l, lerr := strconv.Atoi(line)
		c, cerr := strconv.Atoi(cmp.Or(column, "1"))
		if lerr != nil || cerr != nil || l < 1 || c < 1 {
			return
		}
		ds = append(ds, api.Diagnostic{Line: l, Column: c, Severity: api.DiagnosticSeverity(severity), Message: msg})
	}
	// gcc prints context only when it changes => last user location printed still applies to later diagnostics
	var near []string
	for line := range strings.Lines(out) {
		line = strings.TrimRight(line, "\r\n")
		if d := diagnostic.FindStringSubmatch(line); d != nil {
			path, at, severity, msg := d[1], d[2:4], d[4], d[5]
			if path != file {
				at = near
			}
			if severity == "note" || at == nil {
				continue
			}
			if severity == "fatal error" {
				severity = "error"
			}
			add(at[0], at[1], severity, msg)
			continue
		}
		if ref := undefinedRef.FindStringSubmatch(line); ref != nil {
			add(ref[1], "", "error", ref[2])
			continue
		}
		if at := contextAt.FindStringSubmatch(line); at != nil {
			near = at[1:]
		}
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
