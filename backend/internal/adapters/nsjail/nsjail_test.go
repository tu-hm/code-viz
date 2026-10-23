//go:build linux

package nsjail_test

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/tu-hm/code-viz/backend/internal/adapters/nsjail"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/ports"
	"github.com/tu-hm/code-viz/backend/internal/ports/sandboxtest"
)

func TestSandbox(t *testing.T) {
	sb, _, _ := newSandbox(t)
	_, image := rootfs(t)
	sandboxtest.Run(t, sb, image)
}

func TestStartMissingImageIsInfraError(t *testing.T) {
	sb, _, _ := newSandbox(t)
	_, err := sb.Start(t.Context(), ports.SandboxSpec{JobID: "missing", Image: "absent", Memory: 64 << 20})
	if !errors.Is(err, domain.ErrInfra) {
		t.Fatalf("err = %v, want ErrInfra", err)
	}
}

func TestJailSetupFailureIsInfraError(t *testing.T) {
	sb, _, _ := newSandbox(t)
	images, _ := rootfs(t)
	empty, err := os.MkdirTemp(images, "empty")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Remove(empty); err != nil {
			t.Error(err)
		}
	})
	box, err := sb.Start(t.Context(), ports.SandboxSpec{JobID: "no-work", Image: filepath.Base(empty), Memory: 64 << 20})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := box.Close(t.Context()); err != nil {
			t.Error(err)
		}
	})
	_, err = box.Run(t.Context(), ports.Command{Args: []string{"true"}, Stdout: os.Stdout, Stderr: os.Stderr, Wire: os.Stderr})
	if !errors.Is(err, domain.ErrInfra) || !strings.Contains(err.Error(), "set up jail") {
		t.Fatalf("err = %v, want ErrInfra from jail setup", err)
	}
}

func TestCloseRemovesBox(t *testing.T) {
	sb, cgroup, boxes := newSandbox(t)
	_, image := rootfs(t)
	box, err := sb.Start(t.Context(), ports.SandboxSpec{JobID: "close", Image: image, Files: map[string][]byte{"main.py": []byte("x")}, Memory: 64 << 20})
	if err != nil {
		t.Fatal(err)
	}
	if got := boxDirs(t, cgroup, "close"); len(got) != 1 {
		t.Fatalf("cgroups before close: %v, want one", got)
	}
	if got := boxDirs(t, boxes, "close"); len(got) != 1 {
		t.Fatalf("boxes before close: %v, want one", got)
	}
	if err := box.Close(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := boxDirs(t, cgroup, "close"); len(got) != 0 {
		t.Errorf("cgroups after close: %v, want none", got)
	}
	if got := boxDirs(t, boxes, "close"); len(got) != 0 {
		t.Errorf("boxes after close: %v, want none", got)
	}
}

func TestSweepRemovesBoxesStartedTwoMinutesBeforeNow(t *testing.T) {
	sb, cgroup, boxes := newSandbox(t)
	_, image := rootfs(t)
	box, err := sb.Start(t.Context(), ports.SandboxSpec{JobID: "sweep", Image: image, Memory: 64 << 20})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := box.Close(t.Context()); err != nil {
			t.Error(err)
		}
	})
	dirs := boxDirs(t, boxes, "sweep")
	if len(dirs) != 1 {
		t.Fatalf("boxes after start: %v, want one", dirs)
	}
	sec, err := strconv.ParseInt(strings.Split(filepath.Base(dirs[0]), ".")[1], 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	started := time.Unix(sec, 0)

	if err := sb.Sweep(t.Context(), started.Add(2*time.Minute-time.Nanosecond)); err != nil {
		t.Fatal(err)
	}
	if got := boxDirs(t, cgroup, "sweep"); len(got) != 1 {
		t.Fatalf("cgroups just before 2 minutes: %v, want one", got)
	}
	if got := boxDirs(t, boxes, "sweep"); len(got) != 1 {
		t.Fatalf("boxes just before 2 minutes: %v, want one", got)
	}
	if err := sb.Sweep(t.Context(), started.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got := boxDirs(t, cgroup, "sweep"); len(got) != 0 {
		t.Errorf("cgroups at 2 minutes: %v, want none", got)
	}
	if got := boxDirs(t, boxes, "sweep"); len(got) != 0 {
		t.Errorf("boxes at 2 minutes: %v, want none", got)
	}
}

func TestNewRemovesLeftoverBoxes(t *testing.T) {
	_, cgroup, boxes := newSandbox(t)
	leftover := filepath.Join(cgroup, "leftover.1.00")
	if err := os.MkdirAll(filepath.Join(leftover, "NSJAIL.1"), 0o755); err != nil {
		t.Fatal(err)
	}
	dir, err := os.Open(filepath.Join(leftover, "NSJAIL.1"))
	if err != nil {
		t.Fatal(err)
	}
	defer dir.Close()
	sleep := exec.CommandContext(t.Context(), "sleep", "60")
	sleep.SysProcAttr = &syscall.SysProcAttr{UseCgroupFD: true, CgroupFD: int(dir.Fd())}
	if err := sleep.Start(); err != nil {
		t.Fatal(err)
	}
	work := filepath.Join(boxes, "leftover.1.00")
	if err := os.Mkdir(work, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mount("tmpfs", work, "tmpfs", 0, "size=1m"); err != nil {
		t.Fatal(err)
	}

	images, _ := rootfs(t)
	if _, err := nsjail.New(t.Context(), cgroup, boxes, images); err != nil {
		t.Fatal(err)
	}
	if err := sleep.Wait(); err == nil {
		t.Error("leftover process exited cleanly, want killed")
	}
	if _, err := os.Stat(leftover); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("stat leftover cgroup: err = %v, want not exist", err)
	}
	if _, err := os.Stat(work); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("stat leftover work: err = %v, want not exist", err)
	}
}

func TestNewRefusesCgroupWithoutControllers(t *testing.T) {
	cgroup := filepath.Join(parentCgroup(t), "plain-"+strings.ReplaceAll(t.Name(), "/", "-"))
	if err := os.Mkdir(cgroup, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Remove(cgroup); err != nil {
			t.Error(err)
		}
	})
	_, err := nsjail.New(t.Context(), cgroup, boxesDir(t), t.TempDir())
	if !errors.Is(err, domain.ErrInfra) || !strings.Contains(err.Error(), "does not enable") {
		t.Fatalf("err = %v, want ErrInfra naming the missing controller", err)
	}
}

func newSandbox(t *testing.T) (sb *nsjail.Sandbox, cgroup, boxes string) {
	t.Helper()
	cgroup = filepath.Join(parentCgroup(t), strings.ReplaceAll(t.Name(), "/", "-"))
	if err := os.Mkdir(cgroup, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Remove(cgroup); err != nil {
			t.Error(err)
		}
	})
	if err := os.WriteFile(filepath.Join(cgroup, "cgroup.subtree_control"), []byte("+cpu +memory +pids"), 0); err != nil {
		t.Fatal(err)
	}
	boxes = boxesDir(t)
	images, _ := rootfs(t)
	sb, err := nsjail.New(t.Context(), cgroup, boxes, images)
	if err != nil {
		t.Fatal(err)
	}
	return sb, cgroup, boxes
}

func boxesDir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("/var/tmp", "viz-boxes")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(dir); err != nil {
			t.Error(err)
		}
	})
	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	return dir
}

func parentCgroup(t *testing.T) string {
	t.Helper()
	cgroup := os.Getenv("VIZ_NSJAIL_TEST_CGROUP")
	if cgroup == "" {
		t.Skip("needs root, nsjail and a delegated cgroup; run make test-nsjail")
	}
	return cgroup
}

func rootfs(t *testing.T) (images, image string) {
	t.Helper()
	dir := os.Getenv("VIZ_NSJAIL_TEST_ROOTFS")
	if dir == "" {
		t.Skip("needs a runner rootfs; run make test-nsjail")
	}
	return filepath.Dir(dir), filepath.Base(dir)
}

func boxDirs(t *testing.T, dir, job string) []string {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(dir, job+".*"))
	if err != nil {
		t.Fatal(err)
	}
	return matches
}
