# syntax=docker/dockerfile:1

# Stage 1: Build frontend and compile binary
FROM --platform=$BUILDPLATFORM oven/bun:1 AS builder

# Build arguments
ARG TARGETPLATFORM
ARG BUILDPLATFORM
ARG VERSION=dev
ARG GIT_COMMIT=unknown

WORKDIR /app

# Install build tools needed for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files for dependency installation
COPY package.json bun.lock* ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY shared/package.json shared/
COPY plugins/headlamp/package.json plugins/headlamp/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build frontend
RUN bun run build:frontend

# Embed frontend assets into backend
RUN cd backend && bun run embed

# Compile static binary for target platform
RUN cd backend && \
    if [ "$TARGETPLATFORM" = "linux/arm64" ]; then \
      TARGET="bun-linux-arm64"; \
    else \
      TARGET="bun-linux-x64"; \
    fi && \
    VERSION=${VERSION} GIT_COMMIT=${GIT_COMMIT} bun run scripts/compile.ts \
      --target=$TARGET \
      --outfile=kubefoundry

# Stage 2: Runtime with distroless
# Using cc-debian12 which includes glibc (required by Bun-compiled binaries)
FROM gcr.io/distroless/cc-debian12:nonroot

# Labels for container registry
LABEL org.opencontainers.image.title="KubeFoundry"
LABEL org.opencontainers.image.description="Web-based platform for deploying and managing LLM frameworks on Kubernetes"
LABEL org.opencontainers.image.source="https://github.com/sozercan/kube-foundry"
LABEL org.opencontainers.image.licenses="MIT"

# Copy the compiled binary
COPY --from=builder /app/dist/kubefoundry /kubefoundry

# Expose the default port
EXPOSE 3001

# Run as non-root user (provided by distroless:nonroot)
USER nonroot:nonroot

# Start the application
ENTRYPOINT ["/kubefoundry"]
