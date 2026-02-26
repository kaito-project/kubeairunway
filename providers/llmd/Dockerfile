# Build the provider binary
FROM golang:1.25 AS builder
ARG TARGETOS
ARG TARGETARCH

WORKDIR /workspace

# Disable workspace mode; use replace directives from go.mod
ENV GOWORK=off

# Copy provider module manifests and vendor directory (avoids network access during build)
# vendor/ includes the local controller dependency resolved from the replace directive
COPY providers/llmd/go.mod providers/llmd/go.sum providers/llmd/
COPY providers/llmd/vendor providers/llmd/vendor/

# Copy the provider Go source
COPY providers/llmd/ providers/llmd/

# Build
RUN cd providers/llmd && CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build -mod=vendor -a -o provider cmd/main.go

# Use distroless as minimal base image to package the provider binary
FROM gcr.io/distroless/static:nonroot
WORKDIR /
COPY --from=builder /workspace/providers/llmd/provider .
USER 65532:65532

ENTRYPOINT ["/provider"]
