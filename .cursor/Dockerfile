# Toolchain for Codeberg cloud agents: C core (CMake), Go daemon, Node agent.
# Cursor checks out the repo at runtime — do not COPY the project here.

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    curl \
    git \
    libcurl4-openssl-dev \
    libpq-dev \
    ninja-build \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Go 1.22+ (daemon/)
ENV GO_VERSION=1.22.12
RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" \
    | tar -C /usr/local -xzf -
ENV PATH="/usr/local/go/bin:${PATH}"

# Node.js 22 (agent/)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
