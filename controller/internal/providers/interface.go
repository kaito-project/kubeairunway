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

// Package providers contains the provider interface and implementations.
// Each provider is responsible for:
// 1. Transforming ModelDeployment specs to upstream CRDs (e.g., DynamoGraphDeployment)
// 2. Syncing status from upstream resources back to ModelDeployment
// 3. Registering itself via InferenceProviderConfig
package providers

import (
	"context"

	kubefoundryv1alpha1 "github.com/kubefoundry/kubefoundry/controller/api/v1alpha1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// ProviderName is the name of a provider
type ProviderName string

const (
	// ProviderDynamo is the NVIDIA Dynamo provider
	ProviderDynamo ProviderName = "dynamo"
	// ProviderKaito is the KAITO provider
	ProviderKaito ProviderName = "kaito"
	// ProviderKubeRay is the KubeRay provider
	ProviderKubeRay ProviderName = "kuberay"
)

// Provider defines the interface that all providers must implement.
// Following the plugin architecture pattern (similar to CRI), each provider
// acts as an adapter that translates ModelDeployment to upstream CRDs.
type Provider interface {
	// Name returns the provider name
	Name() ProviderName

	// CanHandle returns whether this provider can handle the given ModelDeployment
	// and a reason if it cannot. This performs semantic validation beyond what
	// the core webhook validates.
	CanHandle(md *kubefoundryv1alpha1.ModelDeployment) (bool, string)

	// Transform converts a ModelDeployment to the upstream resource(s).
	// Returns one or more unstructured resources to be created/updated.
	Transform(ctx context.Context, md *kubefoundryv1alpha1.ModelDeployment) ([]*unstructured.Unstructured, error)

	// TranslateStatus maps the upstream resource status back to ModelDeployment status.
	// The upstream resource is passed as unstructured to decouple from upstream types.
	TranslateStatus(upstream *unstructured.Unstructured) (*ProviderStatusResult, error)

	// GetUpstreamGVK returns the GroupVersionKind of the primary upstream resource
	GetUpstreamGVK() UpstreamGVK

	// GetProviderConfig returns the InferenceProviderConfig spec for this provider
	GetProviderConfig() kubefoundryv1alpha1.InferenceProviderConfigSpec
}

// UpstreamGVK represents the GroupVersionKind of an upstream resource
type UpstreamGVK struct {
	Group   string
	Version string
	Kind    string
}

// ProviderStatusResult contains the status fields extracted from an upstream resource
type ProviderStatusResult struct {
	// Phase is the deployment phase
	Phase kubefoundryv1alpha1.DeploymentPhase

	// Message is a human-readable status message
	Message string

	// Replicas contains replica information
	Replicas *kubefoundryv1alpha1.ReplicaStatus

	// Endpoint contains service endpoint information
	Endpoint *kubefoundryv1alpha1.EndpointStatus

	// ResourceName is the name of the upstream resource
	ResourceName string

	// ResourceKind is the kind of the upstream resource
	ResourceKind string
}

// DefaultImages contains the default container images for each provider/engine combination
var DefaultImages = map[ProviderName]map[kubefoundryv1alpha1.EngineType]string{
	ProviderDynamo: {
		kubefoundryv1alpha1.EngineTypeVLLM:   "nvcr.io/nvidia/ai-dynamo/vllm-runtime:0.7.1",
		kubefoundryv1alpha1.EngineTypeSGLang: "nvcr.io/nvidia/ai-dynamo/sglang-runtime:0.7.1",
		kubefoundryv1alpha1.EngineTypeTRTLLM: "nvcr.io/nvidia/ai-dynamo/trtllm-runtime:0.7.1",
	},
	ProviderKaito: {
		// KAITO uses preset images managed by the operator
		kubefoundryv1alpha1.EngineTypeVLLM:     "",
		kubefoundryv1alpha1.EngineTypeLlamaCpp: "", // User must specify
	},
	ProviderKubeRay: {
		kubefoundryv1alpha1.EngineTypeVLLM: "rayproject/ray-ml:2.9.0-py310-gpu",
	},
}
