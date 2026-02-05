# ============================================================================
#                    Makefile for KubeFoundry Headlamp Plugin
# ============================================================================
#
# This Makefile automates the entire build and deployment process for the
# KubeFoundry Headlamp Plugin. It provides a streamlined development workflow
# with commands for building, testing, deploying, and maintaining the plugin.
#
# OVERVIEW:
# ---------
# The build process consists of:
# 1. Build: bun run build (creates dist/main.js)
# 2. Extract: bun run extract (creates .plugins/ with main.js + package.json)
# 3. Deploy: Copy .plugins/* to Headlamp plugins directory
#
# The dist/ directory is automatically cleaned after extraction since it's
# only an intermediate artifact. The .plugins/ directory contains the final
# deployment-ready package.
#
# DIRECTORY STRUCTURE:
# -------------------
# kubefoundry-headlamp-plugin/
# ├── src/                          # Source code
# ├── dist/                         # Build output (temporary, auto-cleaned)
# ├── .plugins/                     # Extracted plugin (deployment ready)
# │   ├── main.js                   # Plugin bundle
# │   └── package.json              # Plugin metadata
# └── ~/Library/Application Support/Headlamp/plugins/kubefoundry-headlamp-plugin/
#                                   # Deployment target (macOS)
#
# COMMON WORKFLOWS:
# ----------------
# First time setup:     make setup
# Daily development:    make dev
# Clean validation:     make validate
# Debug build issues:   make build-debug
#
# PLATFORM SUPPORT:
# -----------------
# Automatically detects macOS and Linux. For Windows, set HEADLAMP_PLUGINS_DIR manually:
# Windows: HEADLAMP_PLUGINS_DIR = $(APPDATA)/Headlamp/plugins
#
# DEPENDENCIES:
# ------------
# - Bun (preferred) or Node.js and npm
# - @kinvolk/headlamp-plugin CLI tools
# - fswatch (optional, for watch mode on macOS)
# - curl (for Headlamp status check)
#
# ============================================================================

# ============================================================================
# VARIABLES
# ============================================================================

PLUGIN_NAME := kubefoundry-headlamp-plugin
SOURCE_DIR := .plugins
DIST_DIR := dist

# Detect OS for platform-specific paths
UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
    HEADLAMP_PLUGINS_DIR := $(HOME)/Library/Application Support/Headlamp/plugins
else ifeq ($(UNAME_S),Linux)
    HEADLAMP_PLUGINS_DIR := $(HOME)/.config/Headlamp/plugins
else
    HEADLAMP_PLUGINS_DIR := $(HOME)/.config/Headlamp/plugins
endif

PLUGIN_INSTALL_DIR := $(HEADLAMP_PLUGINS_DIR)/$(PLUGIN_NAME)

# ============================================================================
# DEFAULT TARGET
# ============================================================================

.PHONY: all
all: build

# ============================================================================
# DEPENDENCY MANAGEMENT
# ============================================================================

# Install dependencies
.PHONY: install
install:
	@echo "Installing dependencies..."
	bun install

# ============================================================================
# BUILD TARGETS
# ============================================================================

# Build the plugin (standard build with cleanup)
# This is the recommended build command for normal development
.PHONY: build
build:
	@echo "Building plugin..."
	bun run build
	@echo "Extracting plugin..."
	bun run extract
	@echo "Cleaning intermediate build artifacts..."
	@rm -rf $(DIST_DIR)

# Build without cleaning intermediate files (useful for debugging)
# Use this when you need to inspect the dist/ directory contents
.PHONY: build-debug
build-debug:
	@echo "Building plugin (debug mode)..."
	bun run build
	@echo "Extracting plugin..."
	bun run extract

# Extract plugin files to .plugins directory
# This copies dist/main.js to .plugins/main.js and adds package.json
.PHONY: extract
extract:
	@echo "Extracting plugin..."
	bun run extract

# ============================================================================
# DEPLOYMENT TARGETS
# ============================================================================

# Deploy the plugin to Headlamp plugins directory
# Automatically builds if .plugins directory doesn't exist
.PHONY: deploy
deploy:
	@echo "Deploying plugin to Headlamp..."
	@if [ ! -d "$(SOURCE_DIR)" ]; then \
		echo "Source directory $(SOURCE_DIR) not found. Running build first..."; \
		$(MAKE) build; \
	fi
	@mkdir -p "$(PLUGIN_INSTALL_DIR)"
	@cp -r $(SOURCE_DIR)/* "$(PLUGIN_INSTALL_DIR)/"
	@echo "Plugin deployed to: $(PLUGIN_INSTALL_DIR)"

# ============================================================================
# CLEANUP TARGETS
# ============================================================================

# Clean build artifacts (dist/, .plugins/, cache)
.PHONY: clean
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf $(DIST_DIR)
	@rm -rf $(SOURCE_DIR)
	@rm -rf node_modules/.cache

# Full clean including node_modules (nuclear option)
.PHONY: clean-all
clean-all: clean
	@echo "Removing node_modules..."
	@rm -rf node_modules

# ============================================================================
# DEVELOPMENT WORKFLOWS
# ============================================================================

# Main development workflow - start dev server with hot reload
# This is the most common command for daily development
.PHONY: dev
dev:
	@echo "Starting development server with hot reload..."
	bun run start

# Build and deploy in one step (without hot reload)
# Use this for one-time deployments
.PHONY: build-deploy
build-deploy: build deploy
	@echo "Build and deploy complete!"

# Full development setup (install, build, deploy)
# Perfect for first-time setup or after git clone
.PHONY: setup
setup: install build deploy
	@echo "Full development setup complete!"

# ============================================================================
# CODE QUALITY TARGETS
# ============================================================================

# Run ESLint
.PHONY: lint
lint:
	@echo "Running linter..."
	bun run lint

# Auto-fix ESLint issues
.PHONY: lint-fix
lint-fix:
	@echo "Fixing linting issues..."
	bun run lint -- --fix

# Run TypeScript compiler check
.PHONY: typecheck
typecheck:
	@echo "Running TypeScript compiler check..."
	bun run tsc

# Run Prettier code formatting
.PHONY: format
format:
	@echo "Formatting code..."
	bun run format

# Run test suite
.PHONY: test
test:
	@echo "Running tests..."
	bun run test

# Run tests in watch mode
.PHONY: test-watch
test-watch:
	bun run test:watch

# ============================================================================
# MONITORING & VALIDATION TARGETS
# ============================================================================

# Check if plugin is installed in Headlamp
.PHONY: check-install
check-install:
	@echo "Checking plugin installation..."
	@if [ -d "$(PLUGIN_INSTALL_DIR)" ]; then \
		echo "✅ Plugin is installed at: $(PLUGIN_INSTALL_DIR)"; \
		ls -la "$(PLUGIN_INSTALL_DIR)"; \
	else \
		echo "❌ Plugin is not installed"; \
	fi

# Check if Headlamp is running on localhost:4466
.PHONY: check-headlamp
check-headlamp:
	@echo "Checking if Headlamp is running..."
	@curl -s http://localhost:4466/plugins > /dev/null && echo "✅ Headlamp is running on http://localhost:4466" || echo "❌ Headlamp is not running on localhost:4466"

# Validate that build is working correctly
# Does a clean build and validates required files are created
.PHONY: validate
validate: clean build
	@echo "Validating build..."
	@if [ -f "$(SOURCE_DIR)/main.js" ] && [ -f "$(SOURCE_DIR)/package.json" ]; then \
		echo "✅ Build validation passed"; \
	else \
		echo "❌ Build validation failed"; \
		exit 1; \
	fi

# ============================================================================
# UTILITY TARGETS
# ============================================================================

# Remove installed plugin from Headlamp
.PHONY: uninstall
uninstall:
	@echo "Uninstalling plugin..."
	@rm -rf "$(PLUGIN_INSTALL_DIR)"
	@echo "Plugin uninstalled"

# Watch mode for development (requires fswatch on macOS)
# Automatically rebuilds and deploys when source files change
.PHONY: watch
watch:
	@echo "Starting watch mode..."
	@echo "Press Ctrl+C to stop"
	@while true; do \
		echo "Watching for changes..."; \
		fswatch -1 src/ || (echo "fswatch not found, using basic watch..."; sleep 5); \
		echo "Changes detected, rebuilding..."; \
		$(MAKE) dev; \
	done

# ============================================================================
# HELP & DOCUMENTATION
# ============================================================================

# Show comprehensive help information
.PHONY: help
help:
	@echo "============================================================================"
	@echo "KubeFoundry Headlamp Plugin Makefile"
	@echo "============================================================================"
	@echo ""
	@echo "COMMON WORKFLOWS:"
	@echo "  make setup      # First time: install, build, and deploy"
	@echo "  make dev        # Development: start dev server with hot reload"
	@echo "  make validate   # Ensure everything builds correctly"
	@echo "  make build-deploy # Build and deploy (one-time)"
	@echo ""
	@echo "BUILD & EXTRACT:"
	@echo "  install         Install dependencies"
	@echo "  build           Build plugin (cleans intermediate files automatically)"
	@echo "  build-debug     Build plugin keeping intermediate files for debugging"
	@echo "  extract         Extract plugin files to .plugins directory"
	@echo "  clean           Clean build artifacts (dist/, .plugins/, cache)"
	@echo "  clean-all       Clean everything including node_modules"
	@echo ""
	@echo "DEPLOYMENT:"
	@echo "  deploy          Deploy plugin to Headlamp plugins directory"
	@echo "  check-install   Check if plugin is installed in Headlamp"
	@echo "  uninstall       Remove plugin from Headlamp"
	@echo ""
	@echo "DEVELOPMENT:"
	@echo "  dev             Start dev server with hot reload (recommended)"
	@echo "  build-deploy    Build and deploy once (no hot reload)"
	@echo "  watch           Watch for changes and auto-rebuild (requires fswatch)"
	@echo ""
	@echo "CODE QUALITY:"
	@echo "  lint            Run ESLint"
	@echo "  lint-fix        Auto-fix ESLint issues"
	@echo "  typecheck       Run TypeScript compiler check"
	@echo "  format          Run Prettier code formatting"
	@echo "  test            Run test suite"
	@echo "  test-watch      Run tests in watch mode"
	@echo ""
	@echo "MONITORING:"
	@echo "  check-headlamp  Check if Headlamp is running on localhost:4466"
	@echo "  validate        Clean build with validation checks"
	@echo ""
	@echo "UTILITIES:"
	@echo "  help            Show this help message"
	@echo ""
	@echo "TROUBLESHOOTING:"
	@echo "  Plugin not loading?     make check-install && make check-headlamp"
	@echo "  Build failures?         make clean-all install build"
	@echo "  Need to debug build?    make build-debug"
	@echo ""
	@echo "For more information, see the header comments in this Makefile."
	@echo "============================================================================"

# ============================================================================
# END OF MAKEFILE
# ============================================================================
