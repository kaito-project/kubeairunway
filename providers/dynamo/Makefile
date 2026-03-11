KUSTOMIZE ?= ../../controller/bin/kustomize
IMG ?= ghcr.io/kaito-project/kubeairunway/dynamo-provider:latest

.PHONY: build docker-build deploy generate-deploy-manifests test-e2e

## Build the provider binary
build:
	go build -o bin/provider ./cmd/main.go
	@echo "✅ Dynamo provider built"

## Build provider Docker image
docker-build:
	docker build -f Dockerfile -t $(IMG) ../..
	@echo "✅ Dynamo provider image built: $(IMG)"

## Deploy provider to the K8s cluster
deploy:
	cd config/manager && ../../$(KUSTOMIZE) edit set image IMAGE_PLACEHOLDER=$(IMG)
	$(KUSTOMIZE) build config/default | kubectl apply -f -
	@git checkout config/manager/kustomization.yaml 2>/dev/null || true
	@echo "✅ Dynamo provider deployed"

## Generate deploy manifest
generate-deploy-manifests:
	@mkdir -p deploy
	cd config/manager && ../../$(KUSTOMIZE) edit set image IMAGE_PLACEHOLDER=$(IMG)
	$(KUSTOMIZE) build config/default > deploy/dynamo.yaml
	@git checkout config/manager/kustomization.yaml 2>/dev/null || true
	@echo "✅ Generated deploy/dynamo.yaml"

## Run e2e tests (requires DYNAMO_INSTALLED=true and a cluster with dynamo provider deployed)
test-e2e:
	DYNAMO_INSTALLED=true go test -tags=e2e -v -timeout 45m ./test/e2e/
