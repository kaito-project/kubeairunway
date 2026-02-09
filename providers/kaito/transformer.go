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
	"encoding/json"
	"fmt"
	"strings"

	kubefoundryv1alpha1 "github.com/kubefoundry/kubefoundry/controller/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

const (
	// KaitoAPIGroup is the API group for KAITO CRDs
	KaitoAPIGroup = "kaito.sh"
	// KaitoAPIVersion is the current API version for KAITO CRDs
	KaitoAPIVersion = "v1beta1"
	// WorkspaceKind is the kind for KAITO Workspace
	WorkspaceKind = "Workspace"

	// DefaultLlamaCppPort is the default serving port for llamacpp containers
	DefaultLlamaCppPort = 5000
	// DefaultPresetPort is the default serving port for KAITO preset models
	DefaultPresetPort = 80
)

// Transformer handles transformation of ModelDeployment to KAITO Workspace
type Transformer struct{}

// NewTransformer creates a new KAITO transformer
func NewTransformer() *Transformer {
	return &Transformer{}
}

// Transform converts a ModelDeployment to a KAITO Workspace
func (t *Transformer) Transform(ctx context.Context, md *kubefoundryv1alpha1.ModelDeployment) ([]*unstructured.Unstructured, error) {
	ws := &unstructured.Unstructured{}
	ws.SetAPIVersion(fmt.Sprintf("%s/%s", KaitoAPIGroup, KaitoAPIVersion))
	ws.SetKind(WorkspaceKind)
	ws.SetName(md.Name)
	ws.SetNamespace(md.Namespace)

	// Set owner reference
	ws.SetOwnerReferences([]metav1.OwnerReference{
		{
			APIVersion:         md.APIVersion,
			Kind:               md.Kind,
			Name:               md.Name,
			UID:                md.UID,
			Controller:         boolPtr(true),
			BlockOwnerDeletion: boolPtr(true),
		},
	})

	// Set labels
	labels := map[string]string{
		"kubefoundry.ai/managed-by":    "kubefoundry",
		"kubefoundry.ai/deployment":    md.Name,
		"kubefoundry.ai/model-source":  string(md.Spec.Model.Source),
		"kubefoundry.ai/engine-type":   string(md.Spec.Engine.Type),
	}
	// Merge podTemplate labels onto the Workspace
	if md.Spec.PodTemplate != nil && md.Spec.PodTemplate.Metadata != nil {
		for k, v := range md.Spec.PodTemplate.Metadata.Labels {
			labels[k] = v
		}
	}
	ws.SetLabels(labels)

	// Merge podTemplate annotations onto the Workspace
	if md.Spec.PodTemplate != nil && md.Spec.PodTemplate.Metadata != nil && len(md.Spec.PodTemplate.Metadata.Annotations) > 0 {
		ws.SetAnnotations(md.Spec.PodTemplate.Metadata.Annotations)
	}

	// Build resource spec
	resource := t.buildResource(md)

	// Build inference spec based on engine type
	inference, err := t.buildInference(md)
	if err != nil {
		return nil, fmt.Errorf("failed to build inference spec: %w", err)
	}

	// KAITO Workspace CRD has resource and inference at root level, not under spec
	if err := unstructured.SetNestedField(ws.Object, resource, "resource"); err != nil {
		return nil, fmt.Errorf("failed to set resource: %w", err)
	}
	if err := unstructured.SetNestedField(ws.Object, inference, "inference"); err != nil {
		return nil, fmt.Errorf("failed to set inference: %w", err)
	}

	// Apply escape hatch overrides last so they can override any field
	if err := applyOverrides(ws, md); err != nil {
		return nil, fmt.Errorf("failed to apply provider overrides: %w", err)
	}

	return []*unstructured.Unstructured{ws}, nil
}

// buildResource creates the resource section of the Workspace spec
func (t *Transformer) buildResource(md *kubefoundryv1alpha1.ModelDeployment) map[string]interface{} {
	resource := map[string]interface{}{}

	// Map scaling.replicas → spec.resource.count
	count := int64(1)
	if md.Spec.Scaling != nil && md.Spec.Scaling.Replicas > 0 {
		count = int64(md.Spec.Scaling.Replicas)
	}
	resource["count"] = count

	// BYO node mode: use labelSelector instead of instanceType
	matchLabels := map[string]interface{}{
		"kubernetes.io/os": "linux",
	}
	// Merge nodeSelector into matchLabels
	for k, v := range md.Spec.NodeSelector {
		matchLabels[k] = v
	}
	resource["labelSelector"] = map[string]interface{}{
		"matchLabels": matchLabels,
	}

	return resource
}

// buildInference creates the inference section of the Workspace spec
func (t *Transformer) buildInference(md *kubefoundryv1alpha1.ModelDeployment) (map[string]interface{}, error) {
	inference := map[string]interface{}{}

	switch md.Spec.Engine.Type {
	case kubefoundryv1alpha1.EngineTypeVLLM:
		// vLLM preset path: KAITO manages the image
		inference["preset"] = map[string]interface{}{
			"name": md.Spec.Model.ID,
		}
	case kubefoundryv1alpha1.EngineTypeLlamaCpp:
		// llamacpp template path: user-provided image with pod template
		template, err := t.buildLlamaCppTemplate(md)
		if err != nil {
			return nil, err
		}
		inference["template"] = template
	default:
		return nil, fmt.Errorf("unsupported engine type for KAITO: %s", md.Spec.Engine.Type)
	}

	return inference, nil
}

// buildLlamaCppTemplate creates the pod template spec for llamacpp inference
func (t *Transformer) buildLlamaCppTemplate(md *kubefoundryv1alpha1.ModelDeployment) (map[string]interface{}, error) {
	if md.Spec.Image == "" {
		return nil, fmt.Errorf("image is required for llamacpp engine type")
	}

	// Build container args
	args := []interface{}{
		fmt.Sprintf("huggingface://%s", md.Spec.Model.ID),
		"--address=:5000",
	}
	if md.Spec.Model.ServedName != "" {
		args = append(args, fmt.Sprintf("--served-model-name=%s", md.Spec.Model.ServedName))
	}

	// Build container ports
	ports := []interface{}{
		map[string]interface{}{
			"containerPort": int64(DefaultLlamaCppPort),
		},
	}

	// Build container
	container := map[string]interface{}{
		"name":  "model",
		"image": md.Spec.Image,
		"args":  args,
		"ports": ports,
	}

	// Add resource requests
	resources := t.buildResourceRequests(md.Spec.Resources)
	if len(resources) > 0 {
		container["resources"] = resources
	}

	// Build env vars
	envVars := t.buildEnvVars(md)
	if len(envVars) > 0 {
		container["env"] = envVars
	}

	template := map[string]interface{}{
		"spec": map[string]interface{}{
			"containers": []interface{}{container},
		},
	}

	return template, nil
}

// buildResourceRequests creates resource requests from ResourceSpec
func (t *Transformer) buildResourceRequests(spec *kubefoundryv1alpha1.ResourceSpec) map[string]interface{} {
	if spec == nil {
		return nil
	}

	requests := map[string]interface{}{}

	if spec.Memory != "" {
		requests["memory"] = spec.Memory
	}
	if spec.CPU != "" {
		requests["cpu"] = spec.CPU
	}

	if len(requests) == 0 {
		return nil
	}

	return map[string]interface{}{
		"requests": requests,
	}
}

// buildEnvVars constructs environment variables including HF_TOKEN from secrets
func (t *Transformer) buildEnvVars(md *kubefoundryv1alpha1.ModelDeployment) []interface{} {
	var envVars []interface{}

	// Add user-specified env vars
	for _, e := range md.Spec.Env {
		ev := map[string]interface{}{
			"name": e.Name,
		}
		if e.Value != "" {
			ev["value"] = e.Value
		}
		if e.ValueFrom != nil && e.ValueFrom.SecretKeyRef != nil {
			ev["valueFrom"] = map[string]interface{}{
				"secretKeyRef": map[string]interface{}{
					"name": e.ValueFrom.SecretKeyRef.Name,
					"key":  e.ValueFrom.SecretKeyRef.Key,
				},
			}
		}
		envVars = append(envVars, ev)
	}

	// Add HF_TOKEN from secret if specified
	if md.Spec.Secrets != nil && md.Spec.Secrets.HuggingFaceToken != "" {
		envVars = append(envVars, map[string]interface{}{
			"name": "HF_TOKEN",
			"valueFrom": map[string]interface{}{
				"secretKeyRef": map[string]interface{}{
					"name": md.Spec.Secrets.HuggingFaceToken,
					"key":  "HF_TOKEN",
				},
			},
		})
	}

	return envVars
}

// sanitizeLabelValue ensures a value is valid for a Kubernetes label
func sanitizeLabelValue(value string) string {
	// Labels must be 63 chars or less, start and end with alphanumeric
	if len(value) > 63 {
		value = value[:63]
	}
	// Replace invalid characters with dashes
	value = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			return r
		}
		return '-'
	}, value)
	// Trim leading/trailing dashes
	value = strings.Trim(value, "-_.")
	return value
}

// boolPtr returns a pointer to a bool
func boolPtr(b bool) *bool {
	return &b
}

// applyOverrides deep-merges spec.provider.overrides into the unstructured object.
// This is the escape hatch that lets users set arbitrary fields on the provider CRD.
func applyOverrides(obj *unstructured.Unstructured, md *kubefoundryv1alpha1.ModelDeployment) error {
	if md.Spec.Provider == nil || md.Spec.Provider.Overrides == nil {
		return nil
	}

	var overrides map[string]interface{}
	if err := json.Unmarshal(md.Spec.Provider.Overrides.Raw, &overrides); err != nil {
		return fmt.Errorf("failed to unmarshal overrides: %w", err)
	}

	obj.Object = deepMerge(obj.Object, overrides)
	return nil
}

// deepMerge recursively merges src into dst.
// For maps, values are merged recursively. For all other types, src overwrites dst.
func deepMerge(dst, src map[string]interface{}) map[string]interface{} {
	for key, srcVal := range src {
		if dstVal, exists := dst[key]; exists {
			srcMap, srcOk := srcVal.(map[string]interface{})
			dstMap, dstOk := dstVal.(map[string]interface{})
			if srcOk && dstOk {
				dst[key] = deepMerge(dstMap, srcMap)
				continue
			}
		}
		dst[key] = srcVal
	}
	return dst
}
