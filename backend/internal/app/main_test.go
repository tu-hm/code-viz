package app_test

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"sync/atomic"
	"testing"

	gomysql "github.com/go-sql-driver/mysql"
	"github.com/goccy/go-yaml"
	"github.com/testcontainers/testcontainers-go"
	tcmysql "github.com/testcontainers/testcontainers-go/modules/mysql"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/tu-hm/code-viz/backend/internal/adapters/blobstore"
	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

var (
	rootDSN  string
	s3       string
	resource atomic.Int64
)

func TestMain(m *testing.M) {
	os.Exit(run(m))
}

func run(m *testing.M) int {
	ctx := context.Background()
	for k, v := range map[string]string{"AWS_REGION": "us-east-1", "AWS_ACCESS_KEY_ID": "viz", "AWS_SECRET_ACCESS_KEY": "viz"} {
		if err := os.Setenv(k, v); err != nil {
			fmt.Fprintf(os.Stderr, "set %s: %v\n", k, err)
			return 1
		}
	}

	my, err := tcmysql.Run(ctx, "mysql:8.4.13", tcmysql.WithUsername("root"), tcmysql.WithPassword("test"))
	defer terminate(my)
	if err != nil {
		fmt.Fprintf(os.Stderr, "start mysql: %v\n", err)
		return 1
	}
	if rootDSN, err = my.ConnectionString(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "mysql dsn: %v\n", err)
		return 1
	}

	image, cmd, err := seaweedFS()
	if err != nil {
		fmt.Fprintf(os.Stderr, "read compose.yaml: %v\n", err)
		return 1
	}
	sw, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        image,
			Cmd:          cmd,
			ExposedPorts: []string{"8333/tcp"},
			WaitingFor:   wait.ForHTTP("/healthz").WithPort("8333/tcp"),
		},
		Started: true,
	})
	defer terminate(sw)
	if err != nil {
		fmt.Fprintf(os.Stderr, "start seaweedfs: %v\n", err)
		return 1
	}
	if s3, err = sw.PortEndpoint(ctx, "8333/tcp", "http"); err != nil {
		fmt.Fprintf(os.Stderr, "seaweedfs endpoint: %v\n", err)
		return 1
	}
	return m.Run()
}

func terminate(c testcontainers.Container) {
	if err := testcontainers.TerminateContainer(c); err != nil {
		fmt.Fprintf(os.Stderr, "terminate container: %v\n", err)
	}
}

func seaweedFS() (image string, cmd []string, err error) {
	raw, err := os.ReadFile("../../compose.yaml")
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

func newDB(t *testing.T) *sql.DB {
	t.Helper()
	root, err := mysql.Open(rootDSN)
	if err != nil {
		t.Fatal(err)
	}
	name := fmt.Sprintf("test%d", resource.Add(1))
	_, err = root.ExecContext(t.Context(), "CREATE DATABASE "+name)
	if cerr := root.Close(); cerr != nil {
		t.Error(cerr)
	}
	if err != nil {
		t.Fatal(err)
	}

	cfg, err := gomysql.ParseDSN(rootDSN)
	if err != nil {
		t.Fatal(err)
	}
	cfg.DBName = name
	db, err := mysql.Open(cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	if err := mysql.Migrate(t.Context(), db, "up"); err != nil {
		t.Fatal(err)
	}
	return db
}

type bucket struct {
	ports.BlobStore
	url string
}

func newBucket(t *testing.T) bucket {
	t.Helper()
	name := fmt.Sprintf("test%d", resource.Add(1))
	url := s3 + "/" + name
	if resp := get(t, http.MethodPut, url); resp.StatusCode != http.StatusOK {
		t.Fatalf("create bucket %s: HTTP %d", name, resp.StatusCode)
	}
	return bucket{BlobStore: blobStore(t, s3, name), url: url}
}

func blobStore(t *testing.T, endpoint, name string) ports.BlobStore {
	t.Helper()
	b, err := blobstore.New(t.Context(), blobstore.Config{Endpoint: endpoint, Bucket: name, PathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	return b
}
