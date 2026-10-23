// Package dockersandbox runs jobs in Docker containers for local dev. It is not a security boundary (BE-02 §2).
// Images need viz-shim at /opt/viz/viz-shim, tar and cat.
package dockersandbox

import (
	"archive/tar"
	"bytes"
	"context"
	_ "embed"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"syscall"
	"time"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/moby/moby/api/pkg/stdcopy"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"

	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/ports"
	"github.com/tu-hm/code-viz/backend/internal/shim"
)

// docker's default profile (moby/profiles seccomp v0.1.0, Docker 29) plus personality(ADDR_NO_RANDOMIZE) for GDB
//
//go:embed seccomp.json
var seccompProfile string

const (
	shimPath     = "/opt/viz/viz-shim"
	workDir      = "/work"
	user         = "65534:65534"
	jobLabel     = "viz.job"
	startedLabel = "viz.started"

	// §11, §12
	workSize   = "64m"
	pidsLimit  = 32
	stackLimit = 256 << 20
	nanoCPUs   = 1e9

	killTimeout = 10 * time.Second
	outputMax   = 4 << 10
)

type Sandbox struct {
	docker *client.Client
	arch   string
}

// New connects to the Docker daemon named by DOCKER_HOST, or the default socket, and removes containers left over from earlier runs.
func New(ctx context.Context) (*Sandbox, error) {
	docker, err := client.New(client.FromEnv)
	if err != nil {
		return nil, infra("docker client", err)
	}
	info, err := docker.Info(ctx, client.InfoOptions{})
	if err != nil {
		return nil, errors.Join(infra("docker info", err), docker.Close())
	}

	leftovers, err := docker.ContainerList(ctx, client.ContainerListOptions{
		All:     true,
		Filters: make(client.Filters).Add("label", jobLabel),
	})
	if err != nil {
		return nil, errors.Join(infra("list leftover containers", err), docker.Close())
	}
	for _, c := range leftovers.Items {
		if _, err := docker.ContainerRemove(ctx, c.ID, client.ContainerRemoveOptions{Force: true}); err != nil {
			return nil, errors.Join(infra("remove leftover container "+c.ID, err), docker.Close())
		}
	}
	return &Sandbox{docker: docker, arch: goArch(info.Info.Architecture)}, nil
}

func (s *Sandbox) Close() error {
	return s.docker.Close()
}

func (s *Sandbox) Start(ctx context.Context, spec ports.SandboxSpec) (ports.Box, error) {
	img, err := s.docker.ImageInspect(ctx, spec.Image)
	if cerrdefs.IsNotFound(err) {
		return nil, fmt.Errorf("image %s not found, run make images: %w", spec.Image, domain.ErrInfra)
	}
	if err != nil {
		return nil, infra("inspect image "+spec.Image, err)
	}
	// GDB's ptrace fails under emulation
	if img.Architecture != s.arch {
		return nil, fmt.Errorf("image %s is %s but docker runs %s, run make images: %w", spec.Image, img.Architecture, s.arch, domain.ErrInfra)
	}

	initProcess := true
	pids := int64(pidsLimit)
	created, err := s.docker.ContainerCreate(ctx, client.ContainerCreateOptions{
		Image: spec.Image,
		Config: &container.Config{
			Entrypoint: []string{shimPath},
			User:       user,
			WorkingDir: workDir,
			Labels: map[string]string{
				jobLabel:     spec.JobID,
				startedLabel: time.Now().UTC().Format(time.RFC3339),
			},
		},
		HostConfig: &container.HostConfig{
			NetworkMode:    "none",
			ReadonlyRootfs: true,
			Tmpfs:          map[string]string{workDir: "size=" + workSize + ",exec,mode=1777"},
			Init:           &initProcess,
			CapDrop:        []string{"ALL"},
			SecurityOpt:    []string{"no-new-privileges", "seccomp=" + seccompProfile},
			Resources: container.Resources{
				Memory:     spec.Memory,
				MemorySwap: spec.Memory,
				NanoCPUs:   nanoCPUs,
				PidsLimit:  &pids,
				Ulimits:    []*container.Ulimit{{Name: "stack", Soft: stackLimit, Hard: stackLimit}},
			},
		},
	})
	if err != nil {
		return nil, infra("create container", err)
	}
	b := &box{docker: s.docker, id: created.ID}

	if _, err := s.docker.ContainerStart(ctx, b.id, client.ContainerStartOptions{}); err != nil {
		return nil, errors.Join(infra("start container", err), b.Close(ctx))
	}
	if err := b.writeFiles(ctx, spec.Files); err != nil {
		return nil, errors.Join(infra("write files", err), b.Close(ctx))
	}
	return b, nil
}

type box struct {
	docker   *client.Client
	id       string
	oomKills int
}

func (b *box) Run(ctx context.Context, cmd ports.Command) (ports.Exit, error) {
	_, stream, err := b.exec(ctx, append([]string{shimPath, "--"}, cmd.Args...), cmd.Env, false)
	if err != nil {
		return ports.Exit{}, infra("start command", err)
	}

	killed := make(chan error, 1)
	stopWatchdog := context.AfterFunc(ctx, func() {
		killed <- b.kill(ctx)
		stream.Close()
	})

	frames, framesOut := io.Pipe()
	shimStderr := &capped{max: outputMax}
	copied := make(chan struct{})
	go func() {
		_, err := stdcopy.StdCopy(framesOut, shimStderr, stream.Reader)
		framesOut.CloseWithError(err)
		close(copied)
	}()

	exitFrame, demuxErr := shim.Demux(frames, cmd.Stdout, cmd.Stderr, cmd.Wire)
	frames.Close() //nolint:gosec // io.PipeReader.Close always returns nil; closing unblocks StdCopy when demux stops early
	var killErr error
	if demuxErr != nil {
		killErr = b.kill(ctx)
	}
	stream.Close()
	<-copied

	if !stopWatchdog() {
		if err := <-killed; err != nil {
			return ports.Exit{}, err
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return ports.Exit{Limit: ports.LimitTime}, nil
		}
		return ports.Exit{}, ctx.Err()
	}
	if demuxErr != nil {
		return ports.Exit{}, errors.Join(fmt.Errorf("run %s: %w (viz-shim stderr: %q)", cmd.Args[0], demuxErr, shimStderr.buf), killErr)
	}

	exit := ports.Exit{Code: exitFrame.Code, Signal: exitFrame.Signal}
	if exit.Signal != int(syscall.SIGKILL) {
		return exit, nil
	}
	oomKills, err := b.countOOMKills(ctx)
	if err != nil {
		return ports.Exit{}, infra("count oom kills", err)
	}
	if oomKills > b.oomKills {
		exit.Limit = ports.LimitMemory
	}
	b.oomKills = oomKills
	return exit, nil
}

// inspect's OOMKilled lands milliseconds after the exec ends; the kernel bumps memory.events before the kill
func (b *box) countOOMKills(ctx context.Context) (int, error) {
	_, stream, err := b.exec(ctx, []string{"cat", "/sys/fs/cgroup/memory.events"}, nil, false)
	if err != nil {
		return 0, err
	}
	defer stream.Close()
	events := &capped{max: outputMax}
	if _, err := stdcopy.StdCopy(events, events, stream.Reader); err != nil {
		return 0, fmt.Errorf("read memory.events: %w", err)
	}
	for line := range strings.Lines(string(events.buf)) {
		name, count, _ := strings.Cut(strings.TrimSpace(line), " ")
		if name == "oom_kill" {
			return strconv.Atoi(count)
		}
	}
	return 0, fmt.Errorf("no oom_kill in memory.events: %q", events.buf)
}

func (b *box) Close(ctx context.Context) error {
	if _, err := b.docker.ContainerRemove(ctx, b.id, client.ContainerRemoveOptions{Force: true}); err != nil {
		return infra("remove container", err)
	}
	return nil
}

func (b *box) kill(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), killTimeout)
	defer cancel()
	_, err := b.docker.ContainerKill(ctx, b.id, client.ContainerKillOptions{Signal: "KILL"})
	if err != nil && !cerrdefs.IsConflict(err) { // conflict: already stopped
		return infra("kill container", err)
	}
	return nil
}

func (b *box) exec(ctx context.Context, argv, env []string, stdin bool) (string, client.HijackedResponse, error) {
	created, err := b.docker.ExecCreate(ctx, b.id, client.ExecCreateOptions{
		Cmd:          argv,
		Env:          env,
		AttachStdin:  stdin,
		AttachStdout: true,
		AttachStderr: true,
	})
	if err != nil {
		return "", client.HijackedResponse{}, fmt.Errorf("create exec: %w", err)
	}
	attached, err := b.docker.ExecAttach(ctx, created.ID, client.ExecAttachOptions{})
	if err != nil {
		return "", client.HijackedResponse{}, fmt.Errorf("attach exec: %w", err)
	}
	return created.ID, attached.HijackedResponse, nil
}

// docker cp can't reach a tmpfs on a read-only rootfs, so files go through tar in the box
func (b *box) writeFiles(ctx context.Context, files map[string][]byte) error {
	var archive bytes.Buffer
	tw := tar.NewWriter(&archive)
	for name, data := range files {
		hdr := &tar.Header{Name: name, Mode: 0o644, Size: int64(len(data))}
		if err := tw.WriteHeader(hdr); err != nil {
			return fmt.Errorf("tar header %s: %w", name, err)
		}
		if _, err := tw.Write(data); err != nil {
			return fmt.Errorf("tar %s: %w", name, err)
		}
	}
	if err := tw.Close(); err != nil {
		return fmt.Errorf("close tar: %w", err)
	}

	execID, stream, err := b.exec(ctx, []string{"tar", "-x", "-f", "-", "-C", workDir}, nil, true)
	if err != nil {
		return err
	}
	defer stream.Close()
	if _, err := stream.Conn.Write(archive.Bytes()); err != nil {
		return fmt.Errorf("send tar: %w", err)
	}
	if err := stream.CloseWrite(); err != nil {
		return fmt.Errorf("close tar stream: %w", err)
	}
	output := &capped{max: outputMax}
	if _, err := stdcopy.StdCopy(output, output, stream.Reader); err != nil {
		return fmt.Errorf("read tar output: %w", err)
	}
	inspect, err := b.docker.ExecInspect(ctx, execID, client.ExecInspectOptions{})
	if err != nil {
		return fmt.Errorf("inspect tar: %w", err)
	}
	if inspect.ExitCode != 0 {
		return fmt.Errorf("tar exited %d: %q", inspect.ExitCode, output.buf)
	}
	return nil
}

func infra(op string, err error) error {
	return fmt.Errorf("%s: %w: %w", op, domain.ErrInfra, err)
}

func goArch(daemonArch string) string {
	switch daemonArch {
	case "aarch64":
		return "arm64"
	case "x86_64":
		return "amd64"
	}
	return daemonArch
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
