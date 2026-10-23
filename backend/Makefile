.PHONY: gen test golden-update images dev down reset seed lint fmt vuln check

include .env.example
-include .env
export

SCHEMA_ID := https://github.com/tu-hm/code-viz/schema
GEN_PKG := github.com/tu-hm/code-viz/backend/internal/gen
GOLANGCI_LINT := go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0
GOVULNCHECK := go run golang.org/x/vuln/cmd/govulncheck@v1.9.0

gen:
	go tool go-jsonschema --only-models --tags json --capitalization ID --disable-custom-types-for-maps \
		--schema-package $(SCHEMA_ID)/trace.v1.schema.json=$(GEN_PKG)/trace \
		--schema-output $(SCHEMA_ID)/trace.v1.schema.json=internal/gen/trace/trace.go \
		--schema-root-type $(SCHEMA_ID)/trace.v1.schema.json=Trace \
		--schema-package $(SCHEMA_ID)/wire.v1.schema.json=$(GEN_PKG)/wire \
		--schema-output $(SCHEMA_ID)/wire.v1.schema.json=internal/gen/wire/wire.go \
		--schema-root-type $(SCHEMA_ID)/wire.v1.schema.json=Message \
		schema/trace.v1.schema.json schema/wire.v1.schema.json
	go tool oapi-codegen -config api/oapi-codegen.yaml api/openapi.yaml

test:
	go test ./...

golden-update:
	@echo "golden-update: no golden tests yet; added with the first tracer fixtures (BE-03, BE-04)" >&2; exit 1

images:
	docker build --target api --tag vizd-api:dev .
	docker build --target worker --tag vizd-worker:dev .

dev:
	docker compose up --detach --wait
	go run ./cmd/vizd migrate up
	@$(MAKE) --no-print-directory seed
	go tool air

down:
	docker compose down

reset:
	docker compose down --volumes

seed:
	@echo "seed: nothing to seed yet; sample traces come with BE-13 §1" >&2

lint:
	$(GOLANGCI_LINT) run ./...

fmt:
	$(GOLANGCI_LINT) fmt ./...

vuln:
	$(GOVULNCHECK) ./...

check: lint vuln test
	go mod tidy -diff
	@$(MAKE) --no-print-directory gen
	@test -z "$$(git status --porcelain -- internal/gen)" || { git status --short -- internal/gen; echo "check: make gen changed internal/gen; commit the regenerated code" >&2; exit 1; }
