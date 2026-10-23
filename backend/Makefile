.PHONY: gen gen-go test test-nsjail golden-update images runner-images dev down reset seed lint fmt vuln check

include .env.example
-include .env
export

SCHEMA_ID := https://github.com/tu-hm/code-viz/schema
GEN_PKG := github.com/tu-hm/code-viz/backend/internal/gen
GOLANGCI_LINT := go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0
GOVULNCHECK := go run golang.org/x/vuln/cmd/govulncheck@v1.9.0
SQLC := go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1

gen: gen-go
	pnpm --dir ../web gen

gen-go:
	go tool go-jsonschema --only-models --tags json --disable-omitempty --capitalization ID --disable-custom-types-for-maps \
		--schema-package $(SCHEMA_ID)/trace.v1.schema.json=$(GEN_PKG)/trace \
		--schema-output $(SCHEMA_ID)/trace.v1.schema.json=internal/gen/trace/trace.go \
		--schema-root-type $(SCHEMA_ID)/trace.v1.schema.json=Trace \
		--schema-package $(SCHEMA_ID)/wire.v1.schema.json=$(GEN_PKG)/wire \
		--schema-output $(SCHEMA_ID)/wire.v1.schema.json=internal/gen/wire/wire.go \
		--schema-root-type $(SCHEMA_ID)/wire.v1.schema.json=Message \
		schema/trace.v1.schema.json schema/wire.v1.schema.json
	go tool oapi-codegen -config api/oapi-codegen.yaml api/openapi.yaml
	rm -rf internal/gen/sqlc
	$(SQLC) generate --file internal/adapters/mysql/sqlc.yaml

test: runner-images
	go test ./...

test-nsjail:
	docker build --target nsjail-test --tag viz-nsjail-test:dev .
	docker run --rm --privileged --cgroupns=private -v $(CURDIR):/src -w /src \
		-v viz-go-mod:/go/pkg/mod -v viz-go-build:/root/.cache/go-build viz-nsjail-test:dev \
		scripts/nsjail-cgroups.sh sh -c 'CGO_ENABLED=0 go build -o $$VIZ_NSJAIL_TEST_ROOTFS/opt/viz/viz-shim ./cmd/viz-shim && go test ./internal/adapters/nsjail'

golden-update: runner-images
	go test -run Golden ./internal/tracecore ./cmd/vizctl -update

images: runner-images
	docker build --target api --tag vizd-api:dev .
	docker build --target worker --tag vizd-worker:dev .

runner-images:
	docker build --file adapters/python/Dockerfile --tag "$$(sed -n 's/^image: //p' adapters/python/manifest.yaml)" .

dev:
	docker compose up --detach --wait
	go run ./cmd/vizd migrate up
	@$(MAKE) --no-print-directory seed
	go tool air

down:
	docker compose down

reset:
	docker compose down --volumes

# 409: bucket exists from an earlier seed
seed:
	@code=$$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$(S3_ENDPOINT)/$(S3_BUCKET)") && \
	case $$code in \
	200|409) ;; \
	*) echo "seed: create bucket $(S3_BUCKET): HTTP $$code" >&2; exit 1 ;; \
	esac

lint:
	$(GOLANGCI_LINT) run ./...

fmt:
	$(GOLANGCI_LINT) fmt ./...

vuln:
	$(GOVULNCHECK) ./...

check: lint vuln test test-nsjail
	go mod tidy -diff
	@$(MAKE) --no-print-directory gen-go
	@test -z "$$(git status --porcelain -- internal/gen)" || { git status --short -- internal/gen; echo "check: make gen changed internal/gen; commit the regenerated code" >&2; exit 1; }
