FROM ubuntu:26.04@sha256:c098726dd9b9733f3e885f8de0ef375206a311b0a317eadc40d347b1115fb944
RUN apt-get update \
    && apt-get install --yes --no-install-recommends g++ gdb \
    && rm -rf /var/lib/apt/lists/*
