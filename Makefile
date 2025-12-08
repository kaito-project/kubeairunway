.PHONY: install dev dev-frontend dev-backend build compile lint test clean help

# Default target
help:
	@echo "KubeFoundry Development Commands"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@echo "  install        Install all dependencies"
	@echo "  dev            Start frontend and backend dev servers"
	@echo "  dev-frontend   Start frontend dev server only"
	@echo "  dev-backend    Start backend dev server only"
	@echo "  build          Build all packages"
	@echo "  compile        Build single binary executable"
	@echo "  lint           Run linters"
	@echo "  test           Run tests"
	@echo "  clean          Remove build artifacts and node_modules"
	@echo "  help           Show this help message"

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

# Compile single binary
compile:
	bun run compile
	@echo ""
	@echo "✅ Binary created: backend/dist/kubefoundry"
	@ls -lh backend/dist/kubefoundry

# Linting
lint:
	bun run lint

# Testing
test:
	bun run test

# Clean build artifacts
clean:
	rm -rf node_modules frontend/node_modules backend/node_modules shared/node_modules
	rm -rf frontend/dist backend/dist shared/dist
	rm -f bun.lockb
	@echo "✅ Cleaned all build artifacts"
