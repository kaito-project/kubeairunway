.PHONY: install dev dev-frontend dev-backend build compile lint test clean help
.PHONY: controller-build controller-docker-build controller-install controller-deploy controller-generate

# Controller image
CONTROLLER_IMG ?= ghcr.io/kubefoundry/kubefoundry-controller:latest

# Default target
help:
	@echo "KubeFoundry Development Commands"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@echo "  install                Install all dependencies"
	@echo "  dev                    Start frontend and backend dev servers"
	@echo "  dev-frontend           Start frontend dev server only"
	@echo "  dev-backend            Start backend dev server only"
	@echo "  build                  Build all packages"
	@echo "  compile                Build single binary executable"
	@echo "  compile-all            Cross-compile for all platforms"
	@echo "  compile-linux          Cross-compile for Linux (x64 + arm64)"
	@echo "  compile-darwin         Cross-compile for macOS (x64 + arm64)"
	@echo "  compile-windows        Cross-compile for Windows (x64)"
	@echo "  lint                   Run linters"
	@echo "  test                   Run tests"
	@echo "  clean                  Remove build artifacts and node_modules"
	@echo ""
	@echo "Controller Targets:"
	@echo "  controller-build       Build the Go controller binary"
	@echo "  controller-docker-build Build controller Docker image"
	@echo "  controller-install     Install CRDs into cluster"
	@echo "  controller-deploy      Deploy controller to cluster"
	@echo "  controller-generate    Generate CRD manifests and code"
	@echo ""
	@echo "  help                   Show this help message"

# Install dependencies
install:
	bun install

# Development servers
dev:
	bun run dev

dev-frontend:
	bun run dev:frontend

dev-backend:
	bun run dev:backend

# Build
build:
	bun run build

# Compile single binary (includes frontend)
compile:
	bun run compile
	@echo ""
	@echo "✅ Binary created: dist/kubefoundry (includes frontend)"
	@ls -lh dist/kubefoundry

# Cross-compile for all platforms
compile-all: compile-linux compile-darwin compile-windows
	@echo ""
	@echo "✅ All binaries created in dist/"
	@ls -lh dist/

compile-linux:
	bun run build:frontend
	cd backend && bun run compile:linux-x64
	cd backend && bun run compile:linux-arm64
	@echo "✅ Linux binaries created"

compile-darwin:
	bun run build:frontend
	cd backend && bun run compile:darwin-x64
	cd backend && bun run compile:darwin-arm64
	@echo "✅ macOS binaries created"

compile-windows:
	bun run build:frontend
	cd backend && bun run compile:windows-x64
	@echo "✅ Windows binary created"

# Linting
lint:
	bun run lint

# Testing
test:
	bun run test

# Clean build artifacts
clean:
	rm -rf node_modules frontend/node_modules backend/node_modules shared/node_modules
	rm -rf dist frontend/dist backend/dist shared/dist
	rm -f bun.lockb
	@echo "✅ Cleaned all build artifacts"

# ==================== Controller Targets ====================

# Build the controller binary
controller-build:
	cd controller && go build -o bin/manager ./cmd/main.go
	@echo "✅ Controller binary built: controller/bin/manager"

# Build controller Docker image
controller-docker-build:
	cd controller && docker build -t $(CONTROLLER_IMG) .
	@echo "✅ Controller image built: $(CONTROLLER_IMG)"

# Generate CRD manifests and deep copy code
controller-generate:
	cd controller && make generate manifests
	@echo "✅ Generated CRDs and code"

# Install CRDs into the K8s cluster
controller-install:
	cd controller && make install
	@echo "✅ CRDs installed into cluster"

# Deploy controller to the K8s cluster
controller-deploy:
	cd controller && make deploy IMG=$(CONTROLLER_IMG)
	@echo "✅ Controller deployed to cluster"

# Uninstall CRDs from the K8s cluster
controller-uninstall:
	cd controller && make uninstall
	@echo "✅ CRDs uninstalled from cluster"

# Undeploy controller from the K8s cluster
controller-undeploy:
	cd controller && make undeploy
	@echo "✅ Controller undeployed from cluster"

# Run controller locally (outside cluster)
controller-run:
	cd controller && go run ./cmd/main.go --enable-provider-selector=true

# Run controller tests
controller-test:
	cd controller && go test ./... -coverprofile cover.out
	@echo "✅ Controller tests completed"
