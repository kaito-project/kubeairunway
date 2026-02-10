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

package dynamo

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
	// ProviderConfigName is the name of the InferenceProviderConfig for Dynamo
	ProviderConfigName = "dynamo"

	// ProviderVersion is the version of the Dynamo provider
	ProviderVersion = "dynamo-provider:v0.1.0"

	// ProviderDocumentation is the documentation URL for the Dynamo provider
	ProviderDocumentation = "https://github.com/kaito-project/kubeairunway/tree/main/docs/providers/dynamo.md"

	// HeartbeatInterval is the interval for updating the provider heartbeat
	HeartbeatInterval = 1 * time.Minute
)

// ProviderConfigManager handles registration and heartbeat for the Dynamo provider
type ProviderConfigManager struct {
	client client.Client
}

// NewProviderConfigManager creates a new provider config manager
func NewProviderConfigManager(c client.Client) *ProviderConfigManager {
	return &ProviderConfigManager{
		client: c,
	}
}

// GetProviderConfigSpec returns the InferenceProviderConfigSpec for Dynamo
func GetProviderConfigSpec() kubeairunwayv1alpha1.InferenceProviderConfigSpec {
	return kubeairunwayv1alpha1.InferenceProviderConfigSpec{
		Capabilities: &kubeairunwayv1alpha1.ProviderCapabilities{
			Engines: []kubeairunwayv1alpha1.EngineType{
				kubeairunwayv1alpha1.EngineTypeVLLM,
				kubeairunwayv1alpha1.EngineTypeSGLang,
				kubeairunwayv1alpha1.EngineTypeTRTLLM,
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
				// Select Dynamo for trtllm engine (only provider supporting it)
				Condition: "spec.engine.type == 'trtllm'",
				Priority:  100,
			},
			{
				// Select Dynamo for sglang engine (only provider supporting it)
				Condition: "spec.engine.type == 'sglang'",
				Priority:  100,
			},
			{
				// Select Dynamo for disaggregated mode (best support)
				Condition: "has(spec.serving) && spec.serving.mode == 'disaggregated'",
				Priority:  90,
			},
			{
				// Default selection for GPU workloads with vLLM
				Condition: "has(spec.resources.gpu) && spec.resources.gpu.count > 0 && spec.engine.type == 'vllm'",
				Priority:  50,
			},
		},
		Installation: &kubeairunwayv1alpha1.InstallationInfo{
			Description:      "NVIDIA Dynamo for high-performance GPU inference",
			DefaultNamespace: "dynamo-system",
			HelmRepos: []kubeairunwayv1alpha1.HelmRepo{
				{Name: "nvidia-ai-dynamo", URL: "https://helm.ngc.nvidia.com/nvidia/ai-dynamo"},
			},
			HelmCharts: []kubeairunwayv1alpha1.HelmChart{
				{
					Name:      "dynamo-crds",
					Chart:     "https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-crds-0.7.1.tgz",
					Namespace: "default",
				},
				{
					Name:            "dynamo-platform",
					Chart:           "https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-platform-0.7.1.tgz",
					Namespace:       "dynamo-system",
					CreateNamespace: true,
				},
			},
			Steps: []kubeairunwayv1alpha1.InstallationStep{
				{
					Title:       "Install Dynamo CRDs",
					Command:     "helm fetch https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-crds-0.7.1.tgz && helm install dynamo-crds dynamo-crds-0.7.1.tgz --namespace default",
					Description: "Install the Dynamo Custom Resource Definitions v0.7.1.",
				},
				{
					Title:       "Install Dynamo Platform",
					Command:     "helm fetch https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-platform-0.7.1.tgz && helm install dynamo-platform dynamo-platform-0.7.1.tgz --namespace dynamo-system --create-namespace",
					Description: "Install the Dynamo platform operator v0.7.1.",
				},
			},
		},
		Documentation: ProviderDocumentation,
	}
}

// Register creates or updates the InferenceProviderConfig for Dynamo
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

	// Update status
	return m.UpdateStatus(ctx, true)
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
		Version:           ProviderVersion,
		LastHeartbeat:     &now,
		UpstreamCRDVersion: fmt.Sprintf("%s/%s", DynamoAPIGroup, DynamoAPIVersion),
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
