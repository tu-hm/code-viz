# syntax=docker/dockerfile:1.27.1

FROM --platform=$BUILDPLATFORM golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4 AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
# Deps layer: cached until go.mod/go.sum change.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download
COPY . .
# -s -w strips symbol table + DWARF: ~30-40% smaller binary, stack traces still work.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags='-s -w' -o /out/ ./cmd/vizd ./cmd/viz-shim

FROM debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad AS nsjail
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git make g++ pkg-config bison flex protobuf-compiler libprotobuf-dev libnl-route-3-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --branch 3.6 https://github.com/google/nsjail /nsjail \
    && test "$(git -C /nsjail rev-parse HEAD)" = f78475530b46d0186111a9096b30725f816b55fe \
    && make -C /nsjail -j"$(nproc)"

FROM gcr.io/distroless/static-debian13:nonroot@sha256:18f4cc26c9ffa7f20a359298be7deadac5c607c8e03a02b8119f1a5fc2f82c99 AS api
COPY --from=build /out/vizd /usr/local/bin/vizd
ENTRYPOINT ["/usr/local/bin/vizd"]
CMD ["--role=api"]

# runs as root: nsjail needs a privileged pod on the runner node pool (BE-02 §1)
FROM debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad AS worker
RUN apt-get update && apt-get install -y --no-install-recommends libprotobuf32t64 libnl-route-3-200 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=nsjail /nsjail/nsjail /usr/local/bin/nsjail
COPY scripts/nsjail-cgroups.sh /usr/local/bin/nsjail-cgroups
COPY --from=build /out/viz-shim /usr/local/bin/viz-shim
COPY --from=build /out/vizd /usr/local/bin/vizd
ENTRYPOINT ["/usr/local/bin/vizd"]
CMD ["--role=worker"]

FROM golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4 AS nsjail-test
RUN apt-get update && apt-get install -y --no-install-recommends libprotobuf32t64 libnl-route-3-200 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=nsjail /nsjail/nsjail /usr/local/bin/nsjail
COPY --from=busybox:1.37.0-musl@sha256:5cec3fc171c87218698e85a52af7087de727372aae264a787b8112901a5b0092 / /opt/viz/rootfs/sandboxtest/
RUN cd /opt/viz/rootfs/sandboxtest && mkdir -p work proc opt/viz && touch dev/null dev/zero dev/random dev/urandom
ENV VIZ_NSJAIL_TEST_ROOTFS=/opt/viz/rootfs/sandboxtest VIZ_NSJAIL_TEST_CGROUP=/sys/fs/cgroup/viz
