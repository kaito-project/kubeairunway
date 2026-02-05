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

package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ProviderCapabilities defines what a provider supports
type ProviderCapabilities struct {
	// engines is the list of supported inference engines
	// +optional
	Engines []EngineType `json:"engines,omitempty"`

	// servingModes is the list of supported serving modes
	// +optional
	ServingModes []ServingMode `json:"servingModes,omitempty"`

	// cpuSupport indicates if the provider supports CPU-only inference
	// +optional
	CPUSupport bool `json:"cpuSupport,omitempty"`

	// gpuSupport indicates if the provider supports GPU inference
	// +optional
	GPUSupport bool `json:"gpuSupport,omitempty"`
}

// SelectionRule defines a rule for auto-selecting this provider
type SelectionRule struct {
	// condition is a CEL expression that evaluates to true when this rule matches
	// The expression has access to the full ModelDeployment spec via `spec.*`
	// Examples:
	//   - "!has(spec.resources.gpu) || spec.resources.gpu.count == 0"
	//   - "spec.engine.type == 'llamacpp'"
	//   - "has(spec.resources.gpu) && spec.resources.gpu.count > 0"
	// +kubebuilder:validation:Required
	Condition string `json:"condition"`

	// priority is the priority of this rule (higher values = higher priority)
	// When multiple providers match, the one with the highest priority wins
	// +kubebuilder:validation:Minimum=0
	// +kubebuilder:default=0
	// +optional
	Priority int32 `json:"priority,omitempty"`
}

// InferenceProviderConfigSpec defines the desired state of InferenceProviderConfig
type InferenceProviderConfigSpec struct {
	// capabilities defines what this provider supports
	// +optional
	Capabilities *ProviderCapabilities `json:"capabilities,omitempty"`

	// selectionRules defines rules for auto-selecting this provider
	// Conditions use CEL (Common Expression Language)
	// +optional
	SelectionRules []SelectionRule `json:"selectionRules,omitempty"`

	// documentation is a URL to the provider documentation
	// +optional
	Documentation string `json:"documentation,omitempty"`
}

// InferenceProviderConfigStatus defines the observed state of InferenceProviderConfig.
type InferenceProviderConfigStatus struct {
	// ready indicates if the provider is ready to accept workloads
	// +optional
	Ready bool `json:"ready,omitempty"`

	// version is the version of the provider controller
	// +optional
	Version string `json:"version,omitempty"`

	// lastHeartbeat is the last time the provider controller updated this status
	// +optional
	LastHeartbeat *metav1.Time `json:"lastHeartbeat,omitempty"`

	// upstreamCRDVersion is the API version of the upstream CRD this provider creates
	// +optional
	UpstreamCRDVersion string `json:"upstreamCRDVersion,omitempty"`

	// upstreamSchemaHash is a hash of the upstream CRD schema for version detection
	// +optional
	UpstreamSchemaHash string `json:"upstreamSchemaHash,omitempty"`

	// conditions represent the current state of the InferenceProviderConfig resource
	// +listType=map
	// +listMapKey=type
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Cluster
// +kubebuilder:printcolumn:name="Ready",type="boolean",JSONPath=".status.ready",description="Provider ready"
// +kubebuilder:printcolumn:name="Version",type="string",JSONPath=".status.version",description="Provider version"
// +kubebuilder:printcolumn:name="Age",type="date",JSONPath=".metadata.creationTimestamp"

// InferenceProviderConfig is the Schema for the inferenceproviderconfigs API
// InferenceProviderConfig is a cluster-scoped resource that providers use to register themselves
type InferenceProviderConfig struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	// spec defines the provider capabilities and selection rules
	// +optional
	Spec InferenceProviderConfigSpec `json:"spec,omitempty"`

	// status is written by the provider controller
	// +optional
	Status InferenceProviderConfigStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// InferenceProviderConfigList contains a list of InferenceProviderConfig
type InferenceProviderConfigList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []InferenceProviderConfig `json:"items"`
}

func init() {
	SchemeBuilder.Register(&InferenceProviderConfig{}, &InferenceProviderConfigList{})
}
