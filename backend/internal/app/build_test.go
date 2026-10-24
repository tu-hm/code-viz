package app_test

import (
	"context"
	"io"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/app"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

func TestBuildRunsTheManifestCommandAndEnv(t *testing.T) {
	cpp := domain.Manifest{
		ID:         "cpp17-gcc",
		SourceFile: "main.cpp",
		Build: &domain.Build{
			Cmd:         []string{"g++", "main.cpp", "-o", "main"},
			SafetyFlags: []string{"-D_GLIBCXX_DEBUG", "-fsanitize=undefined"},
			Env:         []string{"TMPDIR=/work"},
			Timeout:     10 * time.Second,
		},
	}
	checked := []string{"g++", "main.cpp", "-o", "main", "-D_GLIBCXX_DEBUG", "-fsanitize=undefined"}
	yes, no := true, false
	tests := []struct {
		name string
		opts trace.Options
		args []string
	}{
		{"unset checks build with the safety flags", trace.Options{}, checked},
		{"checks switched on build with the safety flags", trace.Options{SafetyChecks: &yes}, checked},
		{"checks switched off build without the safety flags", trace.Options{SafetyChecks: &no}, []string{"g++", "main.cpp", "-o", "main"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			box := &buildBox{}
			if _, _, err := app.Build(t.Context(), box, cpp, tc.opts); err != nil {
				t.Fatal(err)
			}
			if diff := cmp.Diff(tc.args, box.ran.Args); diff != "" {
				t.Errorf("args (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff([]string{"VIZ_MODULES_ALLOW=", "TMPDIR=/work"}, box.ran.Env); diff != "" {
				t.Errorf("env (-want +got):\n%s", diff)
			}
		})
	}
}

type buildBox struct {
	out  string
	exit ports.Exit
	ran  ports.Command
}

func (b *buildBox) Run(_ context.Context, cmd ports.Command) (ports.Exit, error) {
	b.ran = cmd
	_, err := io.WriteString(cmd.Stderr, b.out)
	return b.exit, err
}

func (b *buildBox) Close(context.Context) error { return nil }
