.PHONY: gen test golden-update images

SCHEMA_ID := https://github.com/tu-hm/code-viz/schema
GEN_PKG := github.com/tu-hm/code-viz/backend/internal/gen

gen:
	go tool go-jsonschema --only-models --tags json --capitalization ID --disable-custom-types-for-maps \
		--schema-package $(SCHEMA_ID)/trace.v1.schema.json=$(GEN_PKG)/trace \
		--schema-output $(SCHEMA_ID)/trace.v1.schema.json=internal/gen/trace/trace.go \
		--schema-root-type $(SCHEMA_ID)/trace.v1.schema.json=Trace \
		--schema-package $(SCHEMA_ID)/wire.v1.schema.json=$(GEN_PKG)/wire \
		--schema-output $(SCHEMA_ID)/wire.v1.schema.json=internal/gen/wire/wire.go \
		--schema-root-type $(SCHEMA_ID)/wire.v1.schema.json=Message \
		schema/trace.v1.schema.json schema/wire.v1.schema.json

test:
	go test ./...

golden-update:
	@echo "golden-update: no golden tests yet; added with the first tracer fixtures (BE-03, BE-04)" >&2; exit 1

images:
	@echo "images: no Dockerfile yet; added with BE-01 §6" >&2; exit 1
