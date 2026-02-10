/*
Copyright 2026.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package kuberay

import (
	"context"
	"fmt"
	"time"

	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"

	kubeairunwayv1alpha1 "github.com/kaito-project/kubeairunway/controller/api/v1alpha1"
)

const (
	// ProviderConfigName is the name of the InferenceProviderConfig for KubeRay
	ProviderConfigName = "kuberay"

	// ProviderVersion is the version of the KubeRay provider
	ProviderVersion = "kuberay-provider:v0.1.0"

	// ProviderDocumentation is the documentation URL for the KubeRay provider
	ProviderDocumentation = "https://github.com/kaito-project/kubeairunway/tree/main/docs/providers/kuberay.md"

	// HeartbeatInterval is the interval for updating the provider heartbeat
	HeartbeatInterval = 1 * time.Minute
)

// ProviderConfigManager handles registration and heartbeat for the KubeRay provider
type ProviderConfigManager struct {
	client client.Client
}

// NewProviderConfigManager creates a new provider config manager
func NewProviderConfigManager(c client.Client) *ProviderConfigManager {
	return &ProviderConfigManager{
		client: c,
	}
}

// GetProviderConfigSpec returns the InferenceProviderConfigSpec for KubeRay
func GetProviderConfigSpec() kubeairunwayv1alpha1.InferenceProviderConfigSpec {
	return kubeairunwayv1alpha1.InferenceProviderConfigSpec{
		Capabilities: &kubeairunwayv1alpha1.ProviderCapabilities{
			Engines: []kubeairunwayv1alpha1.EngineType{
				kubeairunwayv1alpha1.EngineTypeVLLM,
			},
			ServingModes: []kubeairunwayv1alpha1.ServingMode{
				kubeairunwayv1alpha1.ServingModeAggregated,
				kubeairunwayv1alpha1.ServingModeDisaggregated,
			},
			CPUSupport: false,
			GPUSupport: true,
		},
		SelectionRules: []kubeairunwayv1alpha1.SelectionRule{
			{
				// Prefer for multi-GPU vLLM workloads
				Condition: "has(spec.resources.gpu) && spec.resources.gpu.count > 1 && spec.engine.type == 'vllm'",
				Priority:  80,
			},
		},
		Installation: &kubeairunwayv1alpha1.InstallationInfo{
			Description:      "Ray Serve via KubeRay for distributed Ray-based model serving with vLLM",
			DefaultNamespace: "ray-system",
			HelmRepos: []kubeairunwayv1alpha1.HelmRepo{
				{Name: "kuberay", URL: "https://ray-project.github.io/kuberay-helm/"},
			},
			HelmCharts: []kubeairunwayv1alpha1.HelmChart{
				{
					Name:            "kuberay-operator",
					Chart:           "kuberay/kuberay-operator",
					Version:         "1.3.0",
					Namespace:       "ray-system",
					CreateNamespace: true,
				},
			},
			Steps: []kubeairunwayv1alpha1.InstallationStep{
				{
					Title:       "Add KubeRay Helm Repository",
					Command:     "helm repo add kuberay https://ray-project.github.io/kuberay-helm/",
					Description: "Add the KubeRay Helm repository.",
				},
				{
					Title:       "Update Helm Repositories",
					Command:     "helm repo update",
					Description: "Update local Helm repository cache.",
				},
				{
					Title:       "Install KubeRay Operator",
					Command:     "helm upgrade --install kuberay-operator kuberay/kuberay-operator --version 1.3.0 -n ray-system --create-namespace --wait",
					Description: "Install the KubeRay operator v1.3.0.",
				},
			},
		},
		Documentation: ProviderDocumentation,
	}
}

// Register creates or updates the InferenceProviderConfig for KubeRay
func (m *ProviderConfigManager) Register(ctx context.Context) error {
	logger := log.FromContext(ctx)

	config := &kubeairunwayv1alpha1.InferenceProviderConfig{
		ObjectMeta: metav1.ObjectMeta{
			Name: ProviderConfigName,
		},
		Spec: GetProviderConfigSpec(),
	}

	// Check if config already exists
	existing := &kubeairunwayv1alpha1.InferenceProviderConfig{}
	err := m.client.Get(ctx, types.NamespacedName{Name: ProviderConfigName}, existing)

	if errors.IsNotFound(err) {
		// Create new config
		logger.Info("Creating InferenceProviderConfig", "name", ProviderConfigName)
		if err := m.client.Create(ctx, config); err != nil {
			return fmt.Errorf("failed to create InferenceProviderConfig: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("failed to get InferenceProviderConfig: %w", err)
	} else {
		// Update existing config spec if changed
		existing.Spec = config.Spec
		logger.Info("Updating InferenceProviderConfig", "name", ProviderConfigName)
		if err := m.client.Update(ctx, existing); err != nil {
			return fmt.Errorf("failed to update InferenceProviderConfig: %w", err)
		}
	}

	// Update status — retry briefly after create to allow cache to sync
	var statusErr error
	for i := 0; i < 5; i++ {
		statusErr = m.UpdateStatus(ctx, true)
		if statusErr == nil {
			break
		}
		time.Sleep(time.Duration(i+1) * 200 * time.Millisecond)
	}
	return statusErr
}

// UpdateStatus updates the status of the InferenceProviderConfig
func (m *ProviderConfigManager) UpdateStatus(ctx context.Context, ready bool) error {
	config := &kubeairunwayv1alpha1.InferenceProviderConfig{}
	if err := m.client.Get(ctx, types.NamespacedName{Name: ProviderConfigName}, config); err != nil {
		return fmt.Errorf("failed to get InferenceProviderConfig: %w", err)
	}

	now := metav1.Now()
	config.Status = kubeairunwayv1alpha1.InferenceProviderConfigStatus{
		Ready:              ready,
		Version:            ProviderVersion,
		LastHeartbeat:      &now,
		UpstreamCRDVersion: "ray.io/v1",
	}

	if err := m.client.Status().Update(ctx, config); err != nil {
		return fmt.Errorf("failed to update InferenceProviderConfig status: %w", err)
	}

	return nil
}

// StartHeartbeat starts a goroutine that periodically updates the provider heartbeat
func (m *ProviderConfigManager) StartHeartbeat(ctx context.Context) {
	logger := log.FromContext(ctx)

	go func() {
		ticker := time.NewTicker(HeartbeatInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				logger.Info("Stopping heartbeat goroutine")
				return
			case <-ticker.C:
				if err := m.UpdateStatus(ctx, true); err != nil {
					logger.Error(err, "Failed to update heartbeat")
				}
			}
		}
	}()
}

// Unregister marks the provider as not ready
func (m *ProviderConfigManager) Unregister(ctx context.Context) error {
	return m.UpdateStatus(ctx, false)
}
