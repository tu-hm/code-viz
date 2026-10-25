package blobstore_test

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"sync/atomic"
	"testing"

	"github.com/goccy/go-yaml"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

var (
	s3          string
	bucketCount atomic.Int64
)

func TestMain(m *testing.M) {
	os.Exit(run(m))
}

func run(m *testing.M) int {
	ctx := context.Background()
	image, cmd, err := seaweedFS()
	if err != nil {
		fmt.Fprintf(os.Stderr, "read compose.yaml: %v\n", err)
		return 1
	}
	c, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        image,
			Cmd:          cmd,
			ExposedPorts: []string{"8333/tcp"},
			WaitingFor:   wait.ForHTTP("/healthz").WithPort("8333/tcp"),
		},
		Started: true,
	})
	defer func() {
		if err := testcontainers.TerminateContainer(c, testcontainers.StopTimeout(0)); err != nil {
			fmt.Fprintf(os.Stderr, "terminate seaweedfs: %v\n", err)
		}
	}()
	if err != nil {
		fmt.Fprintf(os.Stderr, "start seaweedfs: %v\n", err)
		return 1
	}
	if s3, err = c.PortEndpoint(ctx, "8333/tcp", "http"); err != nil {
		fmt.Fprintf(os.Stderr, "seaweedfs endpoint: %v\n", err)
		return 1
	}
	return m.Run()
}

func seaweedFS() (image string, cmd []string, err error) {
	raw, err := os.ReadFile("../../../compose.yaml")
	if err != nil {
		return "", nil, err
	}
	var compose struct {
		Services map[string]struct {
			Image   string   `yaml:"image"`
			Command []string `yaml:"command"`
		} `yaml:"services"`
	}
	if err := yaml.Unmarshal(raw, &compose); err != nil {
		return "", nil, err
	}
	s := compose.Services["seaweedfs"]
	return s.Image, s.Command, nil
}

func createBucket(t *testing.T) string {
	t.Helper()
	name := fmt.Sprintf("test%d", bucketCount.Add(1))
	if resp := do(t, http.MethodPut, s3+"/"+name); resp.StatusCode != http.StatusOK {
		t.Fatalf("create bucket %s: HTTP %d", name, resp.StatusCode)
	}
	return name
}
