# syntax=docker/dockerfile:1.27.1

FROM --platform=$BUILDPLATFORM golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4 AS shim
ARG TARGETOS TARGETARCH
WORKDIR /src
# Deps layer: cached until go.mod/go.sum change.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download
COPY cmd/viz-shim cmd/viz-shim
COPY internal/shim internal/shim
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags='-s -w' -o /out/viz-shim ./cmd/viz-shim

FROM python:3.12.16-slim-trixie@sha256:8523d6abeb48ceae0b7240d30c5808fc26cb79c1a635bacdf19cf3baecfbec07
RUN python3 -m pip uninstall --yes --root-user-action ignore pip \
    && find / -xdev -perm /6000 -type f -exec chmod a-s {} +
COPY --from=shim /out/viz-shim /opt/viz/viz-shim
COPY adapters/python/tracer.py /opt/viz/tracer.py
