# syntax=docker/dockerfile:1.27.1

FROM --platform=$BUILDPLATFORM golang:1.27.3-trixie@sha256:fbb7ae40b62ff8afe31662df570d39b4f5052ac32b90dae8e60d7657a20a74f4 AS shim
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download
COPY cmd/viz-shim cmd/viz-shim
COPY internal/shim internal/shim
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags='-s -w' -o /out/viz-shim ./cmd/viz-shim

FROM gcc:13.5.0@sha256:20eec427045c47d0aad1bd28c81d435916c327cd992240aa78350f755d04d04a AS gcc

FROM gcc AS gdb
RUN apt-get update \
    && apt-get install --yes --no-install-recommends libmpfr-dev python3-dev \
    && rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:2d4dd8061d8ded12b6c63f55e45344881e8226105f4d2a9b234040efa5ce7772 https://ftp.gnu.org/gnu/gdb/gdb-14.2.tar.xz /src/
WORKDIR /src/build
RUN tar -xf ../gdb-14.2.tar.xz -C .. \
    && ../gdb-14.2/configure --prefix=/usr/local --with-python=python3 --without-debuginfod CFLAGS=-O2 CXXFLAGS=-O2 \
    && make -j"$(nproc)" MAKEINFO=true all-gdb \
    && make MAKEINFO=true install-gdb DESTDIR=/out

FROM debian:bookworm-slim@sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8
RUN apt-get update \
    && apt-get install --yes --no-install-recommends binutils libc6-dev libexpat1 libgmp10 libmpfr6 libpython3.11 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=gcc /usr/local/ /usr/local/
COPY --from=gdb /out/usr/local/bin/gdb /usr/local/bin/gdb
COPY --from=gdb /out/usr/local/share/gdb/ /usr/local/share/gdb/
COPY --from=shim /out/viz-shim /opt/viz/viz-shim
# lib64 before /usr/lib: debian's libstdc++ (gcc 12) is too old for gcc 13 builds
# printers move under gdb's data dir: the default auto-load safe-path refuses /usr/local/lib64
# pch flags = manifest.yaml build.cmd, and build.cmd + build.safetyFlags; gcc picks the valid one by _GLIBCXX_DEBUG
RUN echo /usr/local/lib64 > /etc/ld.so.conf.d/000-local-lib.conf \
    && ldconfig \
    && mkdir -p /usr/local/share/gdb/auto-load/usr/local/lib64 \
    && mv /usr/local/lib64/libstdc++.so.*-gdb.py /usr/local/share/gdb/auto-load/usr/local/lib64/ \
    && cd "/usr/local/include/c++/$(g++ -dumpfullversion)/$(g++ -dumpmachine)/bits" \
    && mkdir stdc++.h.gch \
    && flags='-std=gnu++17 -O0 -g3 -fno-omit-frame-pointer --coverage -Wall -Wextra -Wshadow -fdiagnostics-plain-output --param ggc-min-heapsize=32768 --param ggc-min-expand=30 -x c++-header stdc++.h' \
    && g++ $flags -o stdc++.h.gch/checks-off.gch \
    && g++ $flags -D_GLIBCXX_DEBUG -fsanitize=undefined -fno-sanitize-recover=all -o stdc++.h.gch/checks-on.gch \
    && rm stdc++.h.gch/*.gcno \
    && find / -xdev -perm /6000 -type f -exec chmod a-s {} +
COPY adapters/cpp/flush_init.cpp adapters/cpp/trace.py adapters/cpp/typemap.json /opt/viz/
