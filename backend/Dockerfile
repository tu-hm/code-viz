# syntax=docker/dockerfile:1.27.1

FROM --platform=$BUILDPLATFORM golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4 AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -o /out/vizd ./cmd/vizd

FROM --platform=$BUILDPLATFORM busybox:1.37.0-musl@sha256:5cec3fc171c87218698e85a52af7087de727372aae264a787b8112901a5b0092 AS gvisor-amd64
ADD --checksum=sha256:1298e8ed9c3fee900f00d2ea96ec2d79d80ed93f2175812f29b7e7da718041a3 \
    https://storage.googleapis.com/gvisor/releases/release/20261019.0/x86_64/gvisor.tar.bz2 /gvisor.tar.bz2

FROM --platform=$BUILDPLATFORM busybox:1.37.0-musl@sha256:5cec3fc171c87218698e85a52af7087de727372aae264a787b8112901a5b0092 AS gvisor-arm64
ADD --checksum=sha256:5790f89dc94b091b5aa0f0b6596aa4391606b3fe5f069e68f440576f3388abd8 \
    https://storage.googleapis.com/gvisor/releases/release/20261019.0/aarch64/gvisor.tar.bz2 /gvisor.tar.bz2

# runsc looks for its sidecars in gvisor-bin/ next to itself
FROM gvisor-${TARGETARCH} AS gvisor
RUN mkdir /out && tar -xjf /gvisor.tar.bz2 -C /out runsc gvisor-bin

FROM gcr.io/distroless/static-debian13:nonroot@sha256:d62067879de890a1def9da0e7766b7d20810a5e5555cef8506b752437d7a3e88 AS api
COPY --from=build /out/vizd /usr/local/bin/vizd
ENTRYPOINT ["/usr/local/bin/vizd"]
CMD ["--role=api"]

# TODO(tu-hm): revisit sandbox tooling and the nonroot user once G1 picks runsc or nsjail and pod privileges (BE-02 §1)
FROM gcr.io/distroless/static-debian13:nonroot@sha256:d62067879de890a1def9da0e7766b7d20810a5e5555cef8506b752437d7a3e88 AS worker
COPY --from=gvisor /out/ /usr/local/bin/
# TODO(tu-hm): copy viz-shim into /usr/local/bin once BE-02 §2 builds it
COPY --from=build /out/vizd /usr/local/bin/vizd
ENTRYPOINT ["/usr/local/bin/vizd"]
CMD ["--role=worker"]
