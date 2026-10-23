//go:build linux

// Package nsjail runs jobs under nsjail (D10, chosen at G1). Each Run is a fresh jail over the box's /work, a 64 MiB tmpfs on the host.
// SandboxSpec.Image is the path of an unpacked runner image. It needs viz-shim at /opt/viz/viz-shim, empty /work and /proc directories,
// and empty files at /dev/null, /dev/zero, /dev/random and /dev/urandom to mount the host devices on.
package nsjail

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"

	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/ports"
	"github.com/tu-hm/code-viz/backend/internal/shim"
)

const (
	shimPath = "/opt/viz/viz-shim"
	workDir  = "/work"
	uid      = 65534
	envPath  = "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

	// §11, §12
	workSize    = "64m"
	pidsLimit   = "32"
	cpuMsPerSec = "1000" // 1 vCPU
	stackMiB    = "256"
	fileSizeMiB = "64"
	openFiles   = "1024"

	// C.9 denylist; TODO(tu-hm): replace with a per-image allowlist before GA (BE-02 §5)
	seccompPolicy = "POLICY viz { ERRNO(1) { mount, umount, pivot_root, unshare, setns, bpf, perf_event_open, keyctl, add_key, request_key, init_module, finit_module, delete_module, kexec_load, reboot } } USE viz DEFAULT ALLOW"

	// nsjail exits 255 when it can't set up the jail
	setupFailed = 255
	killTimeout = 10 * time.Second
	outputMax   = 4 << 10
	boxLifetime = 2 * time.Minute // one job: 30 s deadline (§7.7) plus build and cleanup; older boxes are leftovers
)

var devices = []string{"/dev/null", "/dev/zero", "/dev/random", "/dev/urandom"}

type Sandbox struct {
	bin    string
	cgroup string
	boxes  string
}

// New finds nsjail on PATH and removes every box left over from earlier runs: it assumes one worker per cgroup and boxes directory.
// cgroup is a cgroup v2 directory that enables the cpu, memory and pids controllers for its children.
// boxes holds each box's /work; uid 65534 must be able to reach it, so it and its parents are mode 0755.
func New(ctx context.Context, cgroup, boxes string) (*Sandbox, error) {
	bin, err := exec.LookPath("nsjail")
	if err != nil {
		return nil, infra("find nsjail", err)
	}
	controllers, err := os.ReadFile(filepath.Join(cgroup, "cgroup.subtree_control")) //nolint:gosec // cgroup comes from vizd's config
	if err != nil {
		return nil, infra("read cgroup controllers", err)
	}
	for _, c := range []string{"cpu", "memory", "pids"} {
		if !slices.Contains(strings.Fields(string(controllers)), c) {
			return nil, fmt.Errorf("cgroup %s does not enable %s for its children: %w", cgroup, c, domain.ErrInfra)
		}
	}
	if err := os.MkdirAll(boxes, 0o755); err != nil { //nolint:gosec // the jail's user reaches /work through it
		return nil, infra("create boxes dir", err)
	}

	s := &Sandbox{bin: bin, cgroup: cgroup, boxes: boxes}
	if err := s.sweep(ctx, func(string) bool { return true }); err != nil {
		return nil, err
	}
	return s, nil
}

// Sweep removes boxes started more than boxLifetime before now.
func (s *Sandbox) Sweep(ctx context.Context, now time.Time) error {
	return s.sweep(ctx, func(name string) bool { return startedBy(name, now.Add(-boxLifetime)) })
}

func (s *Sandbox) sweep(ctx context.Context, leftover func(name string) bool) error {
	cgroups, err := os.ReadDir(s.cgroup)
	if err != nil {
		return infra("list leftover cgroups", err)
	}
	for _, e := range cgroups {
		if !e.IsDir() || !leftover(e.Name()) {
			continue
		}
		if err := drain(ctx, filepath.Join(s.cgroup, e.Name())); err != nil {
			return infra("remove leftover cgroup", err)
		}
	}
	boxes, err := os.ReadDir(s.boxes)
	if err != nil {
		return infra("list leftover boxes", err)
	}
	for _, e := range boxes {
		if !leftover(e.Name()) {
			continue
		}
		if err := removeWork(filepath.Join(s.boxes, e.Name())); err != nil {
			return infra("remove leftover box", err)
		}
	}
	return nil
}

// startedBy reads the start time from a box name, <job>.<unix start>.<random>. A name without one counts as a leftover.
func startedBy(name string, t time.Time) bool {
	parts := strings.Split(name, ".")
	if len(parts) < 3 {
		return true
	}
	sec, err := strconv.ParseInt(parts[len(parts)-2], 10, 64)
	return err != nil || !time.Unix(sec, 0).After(t)
}

func (s *Sandbox) Start(ctx context.Context, spec ports.SandboxSpec) (ports.Box, error) {
	if info, err := os.Stat(spec.Image); err != nil || !info.IsDir() {
		return nil, fmt.Errorf("runner image %s is not unpacked on this node: %w", spec.Image, domain.ErrInfra)
	}
	var suffix [4]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return nil, infra("box name", err)
	}
	// job id and start time label the box for the janitor (§7.8)
	name := fmt.Sprintf("%s.%d.%s", spec.JobID, time.Now().Unix(), hex.EncodeToString(suffix[:]))
	b := &box{
		bin:    s.bin,
		rootfs: spec.Image,
		work:   filepath.Join(s.boxes, name),
		cgroup: filepath.Join(s.cgroup, name),
		memory: spec.Memory,
	}

	if err := b.create(spec); err != nil {
		return nil, errors.Join(infra("create box", err), b.Close(ctx))
	}
	return b, nil
}

type box struct {
	bin      string
	rootfs   string
	work     string
	cgroup   string
	memory   int64
	oomKills int
	dead     bool
}

func (b *box) create(spec ports.SandboxSpec) error {
	if err := os.Mkdir(b.work, 0o700); err != nil {
		return err
	}
	if err := syscall.Mount("tmpfs", b.work, "tmpfs", syscall.MS_NOSUID|syscall.MS_NODEV, "size="+workSize+",mode=1777"); err != nil {
		return fmt.Errorf("mount work: %w", err)
	}
	for name, data := range spec.Files {
		path := filepath.Join(b.work, name)
		if err := os.WriteFile(path, data, 0o644); err != nil { //nolint:gosec // the sandbox user reads these files
			return err
		}
		if err := os.Chown(path, uid, uid); err != nil {
			return err
		}
	}

	return os.Mkdir(b.cgroup, 0o700)
}

func (b *box) Run(ctx context.Context, cmd ports.Command) (ports.Exit, error) {
	if b.dead {
		return ports.Exit{}, errors.New("run on a box that was killed")
	}
	id := strconv.Itoa(uid)
	args := []string{
		"--mode", "o",
		"--quiet",
		"--hostname", "viz",
		"--chroot", b.rootfs,
		"--bindmount", b.work + ":" + workDir,
		"--cwd", workDir,
		"--proc_rw", // viz-shim sets /proc/self/oom_score_adj
		"--user", id + ":" + id + ":1",
		"--group", id + ":" + id + ":1",
		"--time_limit", "0",
		"--rlimit_as", "inf",
		"--rlimit_stack", stackMiB,
		"--rlimit_fsize", fileSizeMiB,
		"--rlimit_nofile", openFiles,
		"--persona_addr_no_randomize",
		// nsjail stays outside the box's cgroup and moves the jail into a child of it
		"--use_cgroupv2",
		"--cgroupv2_mount", b.cgroup,
		"--cgroup_mem_max", strconv.FormatInt(b.memory, 10),
		"--cgroup_mem_swap_max", "0",
		"--cgroup_pids_max", pidsLimit,
		"--cgroup_cpu_ms_per_sec", cpuMsPerSec,
		"--seccomp_string", seccompPolicy,
		"--env", envPath,
	}
	for _, d := range devices {
		args = append(args, "--bindmount", d)
	}
	for _, e := range cmd.Env {
		// nsjail copies vizd's own value for a bare name
		if !strings.Contains(e, "=") {
			return ports.Exit{}, fmt.Errorf("env %q has no value", e)
		}
		args = append(args, "--env", e)
	}
	args = append(args, "--", shimPath, "--")
	args = append(args, cmd.Args...)

	runCtx, kill := context.WithCancel(ctx)
	defer kill()
	jail := exec.CommandContext(runCtx, b.bin, args...) //nolint:gosec // runs the user's command inside the jail, by design
	// nsjail kills and reaps the whole jail on SIGTERM
	jail.Cancel = func() error { return jail.Process.Signal(syscall.SIGTERM) }
	jail.WaitDelay = killTimeout
	jailStderr := &capped{max: outputMax}
	jail.Stderr = jailStderr
	frames, err := jail.StdoutPipe()
	if err != nil {
		return ports.Exit{}, infra("stdout pipe", err)
	}
	if err := jail.Start(); err != nil {
		return ports.Exit{}, infra("start nsjail", err)
	}

	exitFrame, demuxErr := shim.Demux(frames, cmd.Stdout, cmd.Stderr, cmd.Wire)
	if demuxErr != nil {
		kill()
	}
	waitErr := jail.Wait()

	if ctx.Err() != nil {
		b.dead = true
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return ports.Exit{Limit: ports.LimitTime}, nil
		}
		return ports.Exit{}, ctx.Err()
	}
	var exitErr *exec.ExitError
	if demuxErr != nil && errors.As(waitErr, &exitErr) && exitErr.ExitCode() == setupFailed {
		return ports.Exit{}, fmt.Errorf("set up jail: %w: %q", domain.ErrInfra, jailStderr.buf)
	}
	if demuxErr != nil {
		b.dead = true
		return ports.Exit{}, fmt.Errorf("run %s: %w (nsjail stderr: %q)", cmd.Args[0], demuxErr, jailStderr.buf)
	}
	if waitErr != nil && !errors.As(waitErr, &exitErr) {
		return ports.Exit{}, infra("wait nsjail", waitErr)
	}

	exit := ports.Exit{Code: exitFrame.Code, Signal: exitFrame.Signal}
	if exit.Signal != int(syscall.SIGKILL) {
		return exit, nil
	}
	oomKills, err := b.countOOMKills()
	if err != nil {
		return ports.Exit{}, infra("count oom kills", err)
	}
	if oomKills > b.oomKills {
		exit.Limit = ports.LimitMemory
	}
	b.oomKills = oomKills
	return exit, nil
}

// memory.events counts the oom kills in nsjail's child cgroups too, after nsjail removes them
func (b *box) countOOMKills() (int, error) {
	events, err := os.ReadFile(filepath.Join(b.cgroup, "memory.events"))
	if err != nil {
		return 0, err
	}
	for line := range strings.Lines(string(events)) {
		name, count, _ := strings.Cut(strings.TrimSpace(line), " ")
		if name == "oom_kill" {
			return strconv.Atoi(count)
		}
	}
	return 0, fmt.Errorf("no oom_kill in memory.events: %q", events)
}

// Close also cleans up after a Start that failed halfway.
func (b *box) Close(context.Context) error {
	if err := os.Remove(b.cgroup); err != nil && !errors.Is(err, os.ErrNotExist) {
		return infra("remove cgroup", err)
	}
	if err := removeWork(b.work); err != nil {
		return infra("remove work", err)
	}
	return nil
}

func removeWork(dir string) error {
	err := syscall.Unmount(dir, 0)
	if err != nil && !errors.Is(err, syscall.EINVAL) && !errors.Is(err, syscall.ENOENT) { // EINVAL: not mounted
		return fmt.Errorf("unmount %s: %w", dir, err)
	}
	return os.RemoveAll(dir)
}

func drain(ctx context.Context, cgroup string) error {
	if err := os.WriteFile(filepath.Join(cgroup, "cgroup.kill"), []byte("1"), 0); err != nil {
		return fmt.Errorf("kill %s: %w", cgroup, err)
	}
	events, err := os.Open(filepath.Join(cgroup, "cgroup.events")) //nolint:gosec // cgroup comes from vizd's config
	if err != nil {
		return err
	}
	defer events.Close()
	buf := make([]byte, 256)
	for {
		n, err := events.ReadAt(buf, 0)
		if err != nil && !errors.Is(err, io.EOF) {
			return fmt.Errorf("read %s events: %w", cgroup, err)
		}
		if strings.Contains(string(buf[:n]), "populated 0") {
			return removeCgroup(cgroup)
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		// the kernel wakes poll with POLLPRI when cgroup.events changes
		fds := []unix.PollFd{{Fd: int32(events.Fd()), Events: unix.POLLPRI}} //nolint:gosec // fds fit in int32
		if _, err := unix.Poll(fds, 1000); err != nil && !errors.Is(err, unix.EINTR) {
			return fmt.Errorf("poll %s events: %w", cgroup, err)
		}
	}
}

// removeCgroup also removes the NSJAIL.<pid> child of a jail whose nsjail died with it
func removeCgroup(cgroup string) error {
	children, err := os.ReadDir(cgroup)
	if err != nil {
		return err
	}
	for _, c := range children {
		if !c.IsDir() {
			continue
		}
		if err := os.Remove(filepath.Join(cgroup, c.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return os.Remove(cgroup)
}

func infra(op string, err error) error {
	return fmt.Errorf("%s: %w: %w", op, domain.ErrInfra, err)
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
