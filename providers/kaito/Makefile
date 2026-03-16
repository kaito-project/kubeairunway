KUSTOMIZE ?= ../../controller/bin/kustomize
IMG ?= ghcr.io/kaito-project/airunway/kaito-provider:latest

.PHONY: build docker-build deploy generate-deploy-manifests

## Build the provider binary
build:
	go build -o bin/provider ./cmd/main.go
	@echo "✅ KAITO provider built"

## Build provider Docker image
docker-build:
	docker build -f Dockerfile -t $(IMG) ../..
	@echo "✅ KAITO provider image built: $(IMG)"

## Deploy provider to the K8s cluster
deploy:
	cd config/manager && ../../$(KUSTOMIZE) edit set image IMAGE_PLACEHOLDER=$(IMG)
	$(KUSTOMIZE) build config/default | kubectl apply -f -
	@git checkout config/manager/kustomization.yaml 2>/dev/null || true
	@echo "✅ KAITO provider deployed"

## Generate deploy manifest
generate-deploy-manifests:
	@mkdir -p deploy
	cd config/manager && ../../$(KUSTOMIZE) edit set image IMAGE_PLACEHOLDER=$(IMG)
	$(KUSTOMIZE) build config/default > deploy/kaito.yaml
	@git checkout config/manager/kustomization.yaml 2>/dev/null || true
	@echo "✅ Generated deploy/kaito.yaml"
