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

package kaito

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
	// ProviderConfigName is the name of the InferenceProviderConfig for KAITO
	ProviderConfigName = "kaito"

	// ProviderVersion is the version of the KAITO provider
	ProviderVersion = "kaito-provider:v0.1.0"

	// ProviderDocumentation is the documentation URL for the KAITO provider
	ProviderDocumentation = "https://github.com/kaito-project/kubeairunway/tree/main/docs/providers/kaito.md"

	// HeartbeatInterval is the interval for updating the provider heartbeat
	HeartbeatInterval = 1 * time.Minute
)

// ProviderConfigManager handles registration and heartbeat for the KAITO provider
type ProviderConfigManager struct {
	client client.Client
}

// NewProviderConfigManager creates a new provider config manager
func NewProviderConfigManager(c client.Client) *ProviderConfigManager {
	return &ProviderConfigManager{
		client: c,
	}
}

// GetProviderConfigSpec returns the InferenceProviderConfigSpec for KAITO
func GetProviderConfigSpec() kubeairunwayv1alpha1.InferenceProviderConfigSpec {
	return kubeairunwayv1alpha1.InferenceProviderConfigSpec{
		Capabilities: &kubeairunwayv1alpha1.ProviderCapabilities{
			Engines: []kubeairunwayv1alpha1.EngineType{
				kubeairunwayv1alpha1.EngineTypeVLLM,
				kubeairunwayv1alpha1.EngineTypeLlamaCpp,
			},
			ServingModes: []kubeairunwayv1alpha1.ServingMode{
				kubeairunwayv1alpha1.ServingModeAggregated,
			},
			CPUSupport: true,
			GPUSupport: true,
		},
		SelectionRules: []kubeairunwayv1alpha1.SelectionRule{
			{
				// Best for CPU workloads
				Condition: "!has(spec.resources.gpu) || spec.resources.gpu.count == 0",
				Priority:  100,
			},
			{
				// Only llamacpp provider
				Condition: "spec.engine.type == 'llamacpp'",
				Priority:  100,
			},
		},
		Installation: &kubeairunwayv1alpha1.InstallationInfo{
			Description:      "Kubernetes AI Toolchain Operator for simplified model deployment",
			DefaultNamespace: "kaito-workspace",
			HelmRepos: []kubeairunwayv1alpha1.HelmRepo{
				{Name: "kaito", URL: "https://kaito-project.github.io/kaito/charts/kaito"},
			},
			HelmCharts: []kubeairunwayv1alpha1.HelmChart{
				{
					Name:            "kaito-workspace",
					Chart:           "kaito/workspace",
					Version:         "0.8.0",
					Namespace:       "kaito-workspace",
					CreateNamespace: true,
				},
			},
			Steps: []kubeairunwayv1alpha1.InstallationStep{
				{
					Title:       "Add KAITO Helm Repository",
					Command:     "helm repo add kaito https://kaito-project.github.io/kaito/charts/kaito",
					Description: "Add the KAITO Helm repository.",
				},
				{
					Title:       "Update Helm Repositories",
					Command:     "helm repo update",
					Description: "Update local Helm repository cache.",
				},
				{
					Title:       "Install KAITO Workspace Operator",
					Command:     "helm upgrade --install kaito-workspace kaito/workspace --version 0.8.0 -n kaito-workspace --create-namespace --set featureGates.disableNodeAutoProvisioning=true --wait",
					Description: "Install the KAITO workspace operator v0.8.0 with Node Auto-Provisioning disabled (BYO nodes mode).",
				},
			},
		},
		Documentation: ProviderDocumentation,
	}
}

// Register creates or updates the InferenceProviderConfig for KAITO
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
		UpstreamCRDVersion: "kaito.sh/v1beta1",
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
