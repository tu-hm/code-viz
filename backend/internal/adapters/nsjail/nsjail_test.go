//go:build linux

package nsjail_test

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"github.com/tu-hm/code-viz/backend/internal/adapters/nsjail"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/ports"
	"github.com/tu-hm/code-viz/backend/internal/ports/sandboxtest"
)

func TestSandbox(t *testing.T) {
	sb, _, _ := newSandbox(t)
	sandboxtest.Run(t, sb, rootfs(t))
}

func TestStartMissingImageIsInfraError(t *testing.T) {
	sb, _, _ := newSandbox(t)
	_, err := sb.Start(t.Context(), ports.SandboxSpec{JobID: "missing", Image: filepath.Join(t.TempDir(), "absent"), Memory: 64 << 20})
	if !errors.Is(err, domain.ErrInfra) {
		t.Fatalf("err = %v, want ErrInfra", err)
	}
}

func TestJailSetupFailureIsInfraError(t *testing.T) {
	sb, _, _ := newSandbox(t)
	box, err := sb.Start(t.Context(), ports.SandboxSpec{JobID: "no-work", Image: t.TempDir(), Memory: 64 << 20})
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
	box, err := sb.Start(t.Context(), ports.SandboxSpec{JobID: "close", Image: rootfs(t), Files: map[string][]byte{"main.py": []byte("x")}, Memory: 64 << 20})
	if err != nil {
		t.Fatal(err)
	}
	if got := closeDirs(t, cgroup); len(got) != 1 {
		t.Fatalf("cgroups before close: %v, want one", got)
	}
	if got := closeDirs(t, boxes); len(got) != 1 {
		t.Fatalf("boxes before close: %v, want one", got)
	}
	if err := box.Close(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := closeDirs(t, cgroup); len(got) != 0 {
		t.Errorf("cgroups after close: %v, want none", got)
	}
	if got := closeDirs(t, boxes); len(got) != 0 {
		t.Errorf("boxes after close: %v, want none", got)
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

	if _, err := nsjail.New(t.Context(), cgroup, boxes); err != nil {
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
	_, err := nsjail.New(t.Context(), cgroup, boxesDir(t))
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
	sb, err := nsjail.New(t.Context(), cgroup, boxes)
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

func rootfs(t *testing.T) string {
	t.Helper()
	dir := os.Getenv("VIZ_NSJAIL_TEST_ROOTFS")
	if dir == "" {
		t.Skip("needs a runner rootfs; run make test-nsjail")
	}
	return dir
}

func closeDirs(t *testing.T, dir string) []string {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(dir, "close.*"))
	if err != nil {
		t.Fatal(err)
	}
	return matches
}
