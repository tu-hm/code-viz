package dockersandbox_test

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/jsonstream"
	"github.com/moby/moby/client"
	ocispec "github.com/opencontainers/image-spec/specs-go/v1"

	"github.com/tu-hm/code-viz/backend/internal/adapters/dockersandbox"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/ports"
	"github.com/tu-hm/code-viz/backend/internal/ports/sandboxtest"
)

const (
	busybox = "busybox:1.37.0-musl@sha256:5cec3fc171c87218698e85a52af7087de727372aae264a787b8112901a5b0092"
	image   = "viz-sandboxtest:dev"
)

var foreignBusybox = map[string]struct{ arch, ref string }{
	"aarch64": {"amd64", "busybox@sha256:dc88b80842580654294472735332ec7c7789a4010ec9a68b69f9b88c19abede6"},
	"x86_64":  {"arm64", "busybox@sha256:c542a2b3cb3c982440890284aac884e89dbf468d5ff1c206fd2ba8ea23257420"},
}

var (
	imageOnce    sync.Once
	errTestImage error
)

func TestSandbox(t *testing.T) {
	sandboxtest.Run(t, newSandbox(t), testImage(t))
}

func TestStartMissingImageIsInfraError(t *testing.T) {
	_, err := newSandbox(t).Start(t.Context(), ports.SandboxSpec{JobID: "missing", Image: "viz-does-not-exist:dev", Memory: 64 << 20})
	if !errors.Is(err, domain.ErrInfra) || !strings.Contains(err.Error(), "make images") {
		t.Fatalf("err = %v, want ErrInfra telling to run make images", err)
	}
}

func TestStartRefusesEmulatedImage(t *testing.T) {
	docker := newClient(t)
	info, err := docker.Info(t.Context(), client.InfoOptions{})
	if err != nil {
		t.Fatal(err)
	}
	foreign := foreignBusybox[info.Info.Architecture]
	pull, err := docker.ImagePull(t.Context(), foreign.ref, client.ImagePullOptions{
		Platforms: []ocispec.Platform{{OS: "linux", Architecture: foreign.arch}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := pull.Wait(t.Context()); err != nil {
		t.Fatal(err)
	}

	_, err = newSandbox(t).Start(t.Context(), ports.SandboxSpec{JobID: "emulated", Image: foreign.ref, Memory: 64 << 20})
	if !errors.Is(err, domain.ErrInfra) || !strings.Contains(err.Error(), "make images") {
		t.Fatalf("err = %v, want ErrInfra telling to run make images", err)
	}
	if got := jobContainers(t, docker, "emulated"); len(got) != 0 {
		t.Errorf("containers left for a refused image: %v", got)
	}
}

func TestNewUnreachableDaemonIsInfraError(t *testing.T) {
	t.Setenv("DOCKER_HOST", "unix://"+filepath.Join(t.TempDir(), "docker.sock"))
	_, err := dockersandbox.New(t.Context())
	if !errors.Is(err, domain.ErrInfra) {
		t.Fatalf("err = %v, want ErrInfra", err)
	}
}

func TestNewRemovesLeftoverJobContainers(t *testing.T) {
	docker := newClient(t)
	ctx := t.Context()
	testImage(t)
	created, err := docker.ContainerCreate(ctx, client.ContainerCreateOptions{
		Image:  busybox,
		Config: &container.Config{Cmd: []string{"sleep", "60"}, Labels: map[string]string{"viz.job": "leftover"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, err := docker.ContainerRemove(context.WithoutCancel(ctx), created.ID, client.ContainerRemoveOptions{Force: true})
		if err != nil && !cerrdefs.IsNotFound(err) {
			t.Error(err)
		}
	})
	if _, err := docker.ContainerStart(ctx, created.ID, client.ContainerStartOptions{}); err != nil {
		t.Fatal(err)
	}

	newSandbox(t)
	if _, err := docker.ContainerInspect(ctx, created.ID, client.ContainerInspectOptions{}); !cerrdefs.IsNotFound(err) {
		t.Fatalf("inspect leftover: err = %v, want not found", err)
	}
}

func TestCloseRemovesContainer(t *testing.T) {
	docker := newClient(t)
	box, err := newSandbox(t).Start(t.Context(), ports.SandboxSpec{JobID: "close", Image: testImage(t), Memory: 64 << 20})
	if err != nil {
		t.Fatal(err)
	}
	if got := jobContainers(t, docker, "close"); len(got) != 1 {
		t.Fatalf("containers before close: %v, want one", got)
	}
	if err := box.Close(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := jobContainers(t, docker, "close"); len(got) != 0 {
		t.Errorf("containers after close: %v, want none", got)
	}
}

func newSandbox(t *testing.T) *dockersandbox.Sandbox {
	t.Helper()
	sb, err := dockersandbox.New(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := sb.Close(); err != nil {
			t.Error(err)
		}
	})
	return sb
}

func newClient(t *testing.T) *client.Client {
	t.Helper()
	docker, err := client.New(client.FromEnv)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := docker.Close(); err != nil {
			t.Error(err)
		}
	})
	return docker
}

func jobContainers(t *testing.T, docker *client.Client, jobID string) []string {
	t.Helper()
	list, err := docker.ContainerList(t.Context(), client.ContainerListOptions{
		All:     true,
		Filters: make(client.Filters).Add("label", "viz.job="+jobID),
	})
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, c := range list.Items {
		ids = append(ids, c.ID)
	}
	return ids
}

func testImage(t *testing.T) string {
	t.Helper()
	imageOnce.Do(func() { errTestImage = buildTestImage(t.Context(), newClient(t)) })
	if errTestImage != nil {
		t.Fatal(errTestImage)
	}
	return image
}

func buildTestImage(ctx context.Context, docker *client.Client) (err error) {
	info, err := docker.Info(ctx, client.InfoOptions{})
	if err != nil {
		return err
	}
	arch := map[string]string{"aarch64": "arm64", "x86_64": "amd64"}[info.Info.Architecture]

	dir, err := os.MkdirTemp("", "viz-shim")
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, os.RemoveAll(dir)) }()
	shimPath := filepath.Join(dir, "viz-shim")
	cmd := exec.CommandContext(ctx, "go", "build", "-trimpath", "-o", shimPath, "github.com/tu-hm/code-viz/backend/cmd/viz-shim")
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0", "GOOS=linux", "GOARCH="+arch)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("build viz-shim: %w: %s", err, out)
	}
	shim, err := os.ReadFile(shimPath)
	if err != nil {
		return err
	}

	return build(ctx, docker, map[string][]byte{
		"Dockerfile": []byte("FROM " + busybox + "\nCOPY viz-shim /opt/viz/viz-shim\n"),
		"viz-shim":   shim,
	})
}

func build(ctx context.Context, docker *client.Client, files map[string][]byte) error {
	var buildContext bytes.Buffer
	tw := tar.NewWriter(&buildContext)
	for name, data := range files {
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o755, Size: int64(len(data))}); err != nil {
			return err
		}
		if _, err := tw.Write(data); err != nil {
			return err
		}
	}
	if err := tw.Close(); err != nil {
		return err
	}

	resp, err := docker.ImageBuild(ctx, &buildContext, client.ImageBuildOptions{Tags: []string{image}, Remove: true})
	if err != nil {
		return fmt.Errorf("build image: %w", err)
	}
	defer resp.Body.Close()
	dec := json.NewDecoder(resp.Body)
	for {
		var msg jsonstream.Message
		err := dec.Decode(&msg)
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("build image: %w", err)
		}
		if msg.Error != nil {
			return fmt.Errorf("build image: %s", msg.Error.Message)
		}
	}
}
