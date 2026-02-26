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
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	kubeairunwayv1alpha1 "github.com/kaito-project/kubeairunway/controller/api/v1alpha1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

const (
	// DynamoAPIGroup is the API group for Dynamo CRDs
	DynamoAPIGroup = "nvidia.com"
	// DynamoAPIVersion is the current API version for Dynamo CRDs
	DynamoAPIVersion = "v1alpha1"
	// DynamoGraphDeploymentKind is the kind for DynamoGraphDeployment
	DynamoGraphDeploymentKind = "DynamoGraphDeployment"

	// DynamoNamespace is the namespace where DynamoGraphDeployments are created
	DynamoNamespace = "dynamo-system"

	// Default component settings
	DefaultFrontendReplicas = 1
	DefaultFrontendCPU      = "2"
	DefaultFrontendMemory   = "4Gi"
	DefaultRouterMode       = "round-robin"

	// Component types
	ComponentTypeFrontend = "frontend"
	ComponentTypeWorker   = "worker"

	// Sub-component types for disaggregated mode
	SubComponentTypePrefill = "prefill"
	SubComponentTypeDecode  = "decode"
)

// DynamoOverrides contains Dynamo-specific override configuration
type DynamoOverrides struct {
	// RouterMode is the request routing strategy: kv, round-robin, none
	RouterMode string `json:"routerMode,omitempty"`

	// Frontend contains frontend/router component configuration
	Frontend *FrontendOverrides `json:"frontend,omitempty"`
}

// FrontendOverrides contains frontend component configuration
type FrontendOverrides struct {
	Replicas  *int32             `json:"replicas,omitempty"`
	Resources *ResourceOverrides `json:"resources,omitempty"`
}

// ResourceOverrides contains resource overrides
type ResourceOverrides struct {
	CPU    string `json:"cpu,omitempty"`
	Memory string `json:"memory,omitempty"`
}

// Transformer handles transformation of ModelDeployment to DynamoGraphDeployment
type Transformer struct{}

// NewTransformer creates a new Dynamo transformer
func NewTransformer() *Transformer {
	return &Transformer{}
}

// Transform converts a ModelDeployment to a DynamoGraphDeployment
func (t *Transformer) Transform(ctx context.Context, md *kubeairunwayv1alpha1.ModelDeployment) ([]*unstructured.Unstructured, error) {
	// Parse overrides if present
	overrides, err := t.parseOverrides(md)
	if err != nil {
		return nil, fmt.Errorf("failed to parse provider overrides: %w", err)
	}

	// Create the DynamoGraphDeployment
	dgd := &unstructured.Unstructured{}
	dgd.SetAPIVersion(fmt.Sprintf("%s/%s", DynamoAPIGroup, DynamoAPIVersion))
	dgd.SetKind(DynamoGraphDeploymentKind)
	dgd.SetName(dynamoGraphDeploymentName(md.Namespace, md.Name))
	dgd.SetNamespace(DynamoNamespace)

	// Add labels (owner reference cannot cross namespaces, so we track the source via labels)
	labels := map[string]string{
		"kubeairunway.ai/managed-by":          "kubeairunway",
		"kubeairunway.ai/deployment":          md.Name,
		"kubeairunway.ai/deployment-namespace": md.Namespace,
		"kubeairunway.ai/model-id":            sanitizeLabelValue(md.Spec.Model.ID),
		"kubeairunway.ai/engine-type":         string(md.ResolvedEngineType()),
	}
	dgd.SetLabels(labels)

	// Build the spec
	spec := map[string]interface{}{
		"backendFramework": t.mapEngineType(md.ResolvedEngineType()),
	}

	services, err := t.buildServices(md, overrides)
	if err != nil {
		return nil, fmt.Errorf("failed to build services: %w", err)
	}
	spec["services"] = services

	if err := unstructured.SetNestedField(dgd.Object, spec, "spec"); err != nil {
		return nil, fmt.Errorf("failed to set spec: %w", err)
	}

	// Apply escape hatch overrides last so they can override any field
	if err := applyOverrides(dgd, md); err != nil {
		return nil, fmt.Errorf("failed to apply provider overrides: %w", err)
	}

	return []*unstructured.Unstructured{dgd}, nil
}

// parseOverrides parses the provider.overrides field into DynamoOverrides
func (t *Transformer) parseOverrides(md *kubeairunwayv1alpha1.ModelDeployment) (*DynamoOverrides, error) {
	if md.Spec.Provider == nil || md.Spec.Provider.Overrides == nil {
		return &DynamoOverrides{}, nil
	}

	var overrides DynamoOverrides
	if err := json.Unmarshal(md.Spec.Provider.Overrides.Raw, &overrides); err != nil {
		return nil, fmt.Errorf("failed to unmarshal overrides: %w", err)
	}

	return &overrides, nil
}

// mapEngineType maps KubeAIRunway engine types to Dynamo backend framework names
func (t *Transformer) mapEngineType(engineType kubeairunwayv1alpha1.EngineType) string {
	switch engineType {
	case kubeairunwayv1alpha1.EngineTypeVLLM:
		return "vllm"
	case kubeairunwayv1alpha1.EngineTypeSGLang:
		return "sglang"
	case kubeairunwayv1alpha1.EngineTypeTRTLLM:
		return "trtllm"
	default:
		return string(engineType)
	}
}

// buildServices creates the services map for DynamoGraphDeployment
func (t *Transformer) buildServices(md *kubeairunwayv1alpha1.ModelDeployment, overrides *DynamoOverrides) (map[string]interface{}, error) {
	services := map[string]interface{}{}

	// Determine serving mode
	servingMode := kubeairunwayv1alpha1.ServingModeAggregated
	if md.Spec.Serving != nil && md.Spec.Serving.Mode != "" {
		servingMode = md.Spec.Serving.Mode
	}

	// Get the image to use
	image := t.getImage(md)

	// Add frontend service
	services["Frontend"] = t.buildFrontendService(md, overrides)

	if servingMode == kubeairunwayv1alpha1.ServingModeDisaggregated {
		if md.Spec.Scaling == nil {
			return nil, fmt.Errorf("spec.scaling is required for disaggregated serving mode")
		}
		if md.Spec.Scaling.Prefill == nil {
			return nil, fmt.Errorf("spec.scaling.prefill is required for disaggregated serving mode")
		}
		if md.Spec.Scaling.Decode == nil {
			return nil, fmt.Errorf("spec.scaling.decode is required for disaggregated serving mode")
		}
		// Disaggregated mode: separate prefill and decode workers
		prefillWorker, err := t.buildPrefillWorker(md, image)
		if err != nil {
			return nil, fmt.Errorf("failed to build prefill worker: %w", err)
		}
		services["VllmPrefillWorker"] = prefillWorker
		decodeWorker, err := t.buildDecodeWorker(md, image)
		if err != nil {
			return nil, fmt.Errorf("failed to build decode worker: %w", err)
		}
		services["VllmDecodeWorker"] = decodeWorker
	} else {
		// Aggregated mode: single worker
		aggregatedWorker, err := t.buildAggregatedWorker(md, image)
		if err != nil {
			return nil, fmt.Errorf("failed to build aggregated worker: %w", err)
		}
		services["VllmWorker"] = aggregatedWorker
	}

	return services, nil
}

// buildFrontendService creates the frontend service configuration
func (t *Transformer) buildFrontendService(md *kubeairunwayv1alpha1.ModelDeployment, overrides *DynamoOverrides) map[string]interface{} {
	// Determine replicas
	replicas := int64(DefaultFrontendReplicas)
	if overrides.Frontend != nil && overrides.Frontend.Replicas != nil {
		replicas = int64(*overrides.Frontend.Replicas)
	}

	// Determine router mode
	routerMode := DefaultRouterMode
	if overrides.RouterMode != "" {
		routerMode = overrides.RouterMode
	}

	// Determine resources
	cpu := DefaultFrontendCPU
	memory := DefaultFrontendMemory
	if overrides.Frontend != nil && overrides.Frontend.Resources != nil {
		if overrides.Frontend.Resources.CPU != "" {
			cpu = overrides.Frontend.Resources.CPU
		}
		if overrides.Frontend.Resources.Memory != "" {
			memory = overrides.Frontend.Resources.Memory
		}
	}

	frontend := map[string]interface{}{
		"componentType":   ComponentTypeFrontend,
		"dynamoNamespace": md.Name,
		"replicas":        replicas,
		"router-mode":     routerMode,
		"resources": map[string]interface{}{
			"requests": map[string]interface{}{
				"cpu":    cpu,
				"memory": memory,
			},
		},
		"extraPodSpec": map[string]interface{}{
			"labels": map[string]interface{}{
				"kubeairunway.ai/model-deployment": md.Name,
			},
			"mainContainer": map[string]interface{}{
				"image": t.getImage(md),
			},
		},
	}

	// Add secret reference if specified
	if md.Spec.Secrets != nil && md.Spec.Secrets.HuggingFaceToken != "" {
		frontend["envFromSecret"] = md.Spec.Secrets.HuggingFaceToken
	}

	return frontend
}

// buildAggregatedWorker creates the worker service for aggregated mode
func (t *Transformer) buildAggregatedWorker(md *kubeairunwayv1alpha1.ModelDeployment, image string) (map[string]interface{}, error) {
	// Get replicas
	replicas := int64(1)
	if md.Spec.Scaling != nil && md.Spec.Scaling.Replicas > 0 {
		replicas = int64(md.Spec.Scaling.Replicas)
	}

	// Build resource limits
	resources := t.buildResourceLimits(md.Spec.Resources)

	// Build engine arguments
	args, err := t.buildEngineArgs(md)
	if err != nil {
		return nil, err
	}

	worker := map[string]interface{}{
		"componentType":   ComponentTypeWorker,
		"dynamoNamespace": md.Name,
		"replicas":        replicas,
		"resources":       resources,
		"extraPodSpec": map[string]interface{}{
			"labels": map[string]interface{}{
				"kubeairunway.ai/model-deployment": md.Name,
			},
			"mainContainer": map[string]interface{}{
				"image":   image,
				"command": toInterfaceSlice(t.engineCommand(md.ResolvedEngineType())),
				"args":    toInterfaceSlice(args),
			},
		},
	}

	// Add secret reference if specified
	if md.Spec.Secrets != nil && md.Spec.Secrets.HuggingFaceToken != "" {
		worker["envFromSecret"] = md.Spec.Secrets.HuggingFaceToken
	}

	// Add node selector and tolerations
	t.addSchedulingConfig(worker, md)

	return worker, nil
}

// buildPrefillWorker creates the prefill worker for disaggregated mode
func (t *Transformer) buildPrefillWorker(md *kubeairunwayv1alpha1.ModelDeployment, image string) (map[string]interface{}, error) {
	prefillSpec := md.Spec.Scaling.Prefill

	// Build resource limits and requests from component spec
	limits := map[string]interface{}{}
	requests := map[string]interface{}{}

	if prefillSpec.GPU != nil && prefillSpec.GPU.Count > 0 {
		gpuCount := fmt.Sprintf("%d", prefillSpec.GPU.Count)
		limits["gpu"] = gpuCount
		requests["gpu"] = gpuCount
	}
	if prefillSpec.Memory != "" {
		limits["memory"] = prefillSpec.Memory
	}

	resources := map[string]interface{}{
		"limits":   limits,
		"requests": requests,
	}

	// Build engine arguments with prefill flag
	args, err := t.buildEngineArgs(md)
	if err != nil {
		return nil, err
	}
	args = append(args, "--is-prefill-worker")

	worker := map[string]interface{}{
		"componentType":    ComponentTypeWorker,
		"subComponentType": SubComponentTypePrefill,
		"dynamoNamespace":  md.Name,
		"replicas":         int64(prefillSpec.Replicas),
		"resources":        resources,
		"extraPodSpec": map[string]interface{}{
			"labels": map[string]interface{}{
				"kubeairunway.ai/model-deployment": md.Name,
			},
			"mainContainer": map[string]interface{}{
				"image":   image,
				"command": toInterfaceSlice(t.engineCommand(md.ResolvedEngineType())),
				"args":    toInterfaceSlice(args),
			},
		},
	}

	// Add secret reference if specified
	if md.Spec.Secrets != nil && md.Spec.Secrets.HuggingFaceToken != "" {
		worker["envFromSecret"] = md.Spec.Secrets.HuggingFaceToken
	}

	// Add node selector and tolerations
	t.addSchedulingConfig(worker, md)

	return worker, nil
}

// buildDecodeWorker creates the decode worker for disaggregated mode
func (t *Transformer) buildDecodeWorker(md *kubeairunwayv1alpha1.ModelDeployment, image string) (map[string]interface{}, error) {
	decodeSpec := md.Spec.Scaling.Decode

	// Build resource limits and requests from component spec
	limits := map[string]interface{}{}
	requests := map[string]interface{}{}

	if decodeSpec.GPU != nil && decodeSpec.GPU.Count > 0 {
		gpuCount := fmt.Sprintf("%d", decodeSpec.GPU.Count)
		limits["gpu"] = gpuCount
		requests["gpu"] = gpuCount
	}
	if decodeSpec.Memory != "" {
		limits["memory"] = decodeSpec.Memory
	}

	resources := map[string]interface{}{
		"limits":   limits,
		"requests": requests,
	}

	// Build engine arguments (decode workers don't need special flags)
	args, err := t.buildEngineArgs(md)
	if err != nil {
		return nil, err
	}

	worker := map[string]interface{}{
		"componentType":    ComponentTypeWorker,
		"subComponentType": SubComponentTypeDecode,
		"dynamoNamespace":  md.Name,
		"replicas":         int64(decodeSpec.Replicas),
		"resources":        resources,
		"extraPodSpec": map[string]interface{}{
			"labels": map[string]interface{}{
				"kubeairunway.ai/model-deployment": md.Name,
			},
			"mainContainer": map[string]interface{}{
				"image":   image,
				"command": toInterfaceSlice(t.engineCommand(md.ResolvedEngineType())),
				"args":    toInterfaceSlice(args),
			},
		},
	}

	// Add secret reference if specified
	if md.Spec.Secrets != nil && md.Spec.Secrets.HuggingFaceToken != "" {
		worker["envFromSecret"] = md.Spec.Secrets.HuggingFaceToken
	}

	// Add node selector and tolerations
	t.addSchedulingConfig(worker, md)

	return worker, nil
}

// buildResourceLimits creates resource limits and requests from ResourceSpec
func (t *Transformer) buildResourceLimits(spec *kubeairunwayv1alpha1.ResourceSpec) map[string]interface{} {
	limits := map[string]interface{}{}
	requests := map[string]interface{}{}

	if spec == nil {
		return map[string]interface{}{
			"limits":   limits,
			"requests": requests,
		}
	}

	if spec.GPU != nil && spec.GPU.Count > 0 {
		gpuCount := fmt.Sprintf("%d", spec.GPU.Count)
		limits["gpu"] = gpuCount
		requests["gpu"] = gpuCount
	}

	if spec.Memory != "" {
		limits["memory"] = spec.Memory
	}

	if spec.CPU != "" {
		limits["cpu"] = spec.CPU
	}

	return map[string]interface{}{
		"limits":   limits,
		"requests": requests,
	}
}

// buildEngineArgs constructs the engine command line arguments (without the engine runner command)
func (t *Transformer) buildEngineArgs(md *kubeairunwayv1alpha1.ModelDeployment) ([]string, error) {
	var args []string

	// Add model
	args = append(args, "--model", md.Spec.Model.ID)

	// Add served name if specified
	if md.Spec.Model.ServedName != "" {
		args = append(args, "--served-model-name", md.Spec.Model.ServedName)
	}

	// Add context length
	if md.Spec.Engine.ContextLength != nil {
		switch md.ResolvedEngineType() {
		case kubeairunwayv1alpha1.EngineTypeVLLM:
			args = append(args, "--max-model-len", fmt.Sprintf("%d", *md.Spec.Engine.ContextLength))
		case kubeairunwayv1alpha1.EngineTypeSGLang:
			args = append(args, "--context-length", fmt.Sprintf("%d", *md.Spec.Engine.ContextLength))
		// TensorRT-LLM context length is build-time, skip with warning logged elsewhere
		}
	}

	// Add trust remote code
	if md.Spec.Engine.TrustRemoteCode {
		switch md.ResolvedEngineType() {
		case kubeairunwayv1alpha1.EngineTypeVLLM, kubeairunwayv1alpha1.EngineTypeSGLang:
			args = append(args, "--trust-remote-code")
		}
	}

	// Add custom engine args with key validation (sorted for deterministic output)
	keys := make([]string, 0, len(md.Spec.Engine.Args))
	for k := range md.Spec.Engine.Args {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if !isValidArgKey(key) {
			return nil, fmt.Errorf("invalid engine arg key %q: must contain only alphanumeric characters, hyphens, and underscores", key)
		}
		value := md.Spec.Engine.Args[key]
		if value != "" {
			args = append(args, fmt.Sprintf("--%s", key), value)
		} else {
			args = append(args, fmt.Sprintf("--%s", key))
		}
	}

	return args, nil
}

// engineCommand returns the command slice for the given engine type
func (t *Transformer) engineCommand(engineType kubeairunwayv1alpha1.EngineType) []string {
	switch engineType {
	case kubeairunwayv1alpha1.EngineTypeVLLM:
		return []string{"python3", "-m", "dynamo.vllm"}
	case kubeairunwayv1alpha1.EngineTypeSGLang:
		return []string{"python3", "-m", "dynamo.sglang"}
	case kubeairunwayv1alpha1.EngineTypeTRTLLM:
		return []string{"python3", "-m", "dynamo.trtllm"}
	default:
		return []string{"python3", "-m", fmt.Sprintf("dynamo.%s", engineType)}
	}
}

// isValidArgKey checks that an arg key contains only alphanumeric chars, hyphens, and underscores,
// and does not start with a hyphen.
func isValidArgKey(key string) bool {
	if len(key) == 0 {
		return false
	}
	// Must not start with a hyphen to prevent option injection
	if key[0] == '-' {
		return false
	}
	for _, r := range key {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_') {
			return false
		}
	}
	return true
}

// toInterfaceSlice converts a string slice to an interface slice for unstructured construction
func toInterfaceSlice(ss []string) []interface{} {
	result := make([]interface{}, len(ss))
	for i, s := range ss {
		result[i] = s
	}
	return result
}

// defaultImages contains the default container images for each engine type
var defaultImages = map[kubeairunwayv1alpha1.EngineType]string{
	kubeairunwayv1alpha1.EngineTypeVLLM:   "nvcr.io/nvidia/ai-dynamo/vllm-runtime:0.7.1",
	kubeairunwayv1alpha1.EngineTypeSGLang: "nvcr.io/nvidia/ai-dynamo/sglang-runtime:0.7.1",
	kubeairunwayv1alpha1.EngineTypeTRTLLM: "nvcr.io/nvidia/ai-dynamo/trtllm-runtime:0.7.1",
}

// getImage returns the container image to use
func (t *Transformer) getImage(md *kubeairunwayv1alpha1.ModelDeployment) string {
	// Use custom image if specified
	if md.Spec.Image != "" {
		return md.Spec.Image
	}

	// Use default image for engine type
	if image, ok := defaultImages[md.ResolvedEngineType()]; ok && image != "" {
		return image
	}

	// Fallback to vLLM default
	return "nvcr.io/nvidia/ai-dynamo/vllm-runtime:0.7.1"
}

// addSchedulingConfig adds node selector and tolerations to a service
func (t *Transformer) addSchedulingConfig(service map[string]interface{}, md *kubeairunwayv1alpha1.ModelDeployment) {
	extraPodSpec, ok := service["extraPodSpec"].(map[string]interface{})
	if !ok {
		extraPodSpec = map[string]interface{}{}
		service["extraPodSpec"] = extraPodSpec
	}

	if len(md.Spec.NodeSelector) > 0 {
		extraPodSpec["nodeSelector"] = md.Spec.NodeSelector
	}

	if len(md.Spec.Tolerations) > 0 {
		tolerations := make([]interface{}, len(md.Spec.Tolerations))
		for i, t := range md.Spec.Tolerations {
			toleration := map[string]interface{}{
				"key":      t.Key,
				"operator": string(t.Operator),
			}
			if t.Value != "" {
				toleration["value"] = t.Value
			}
			if t.Effect != "" {
				toleration["effect"] = string(t.Effect)
			}
			if t.TolerationSeconds != nil {
				toleration["tolerationSeconds"] = *t.TolerationSeconds
			}
			tolerations[i] = toleration
		}
		extraPodSpec["tolerations"] = tolerations
	}
}

// dynamoGraphDeploymentName returns a unique DGD name by combining the source
// namespace and name. This prevents collisions when multiple ModelDeployments
// with the same name exist in different namespaces but all DGDs land in dynamo-system.
func dynamoGraphDeploymentName(namespace, name string) string {
	result := fmt.Sprintf("%s-%s", namespace, name)
	if len(result) > 253 {
		// Use a hash suffix to preserve uniqueness after truncation
		hash := fmt.Sprintf("%x", sha256.Sum256([]byte(result)))
		suffix := hash[:8]
		result = result[:253-9] + "-" + suffix
	}
	return result
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
func applyOverrides(obj *unstructured.Unstructured, md *kubeairunwayv1alpha1.ModelDeployment) error {
	if md.Spec.Provider == nil || md.Spec.Provider.Overrides == nil {
		return nil
	}

	var overrides map[string]interface{}
	if err := json.Unmarshal(md.Spec.Provider.Overrides.Raw, &overrides); err != nil {
		return fmt.Errorf("failed to unmarshal overrides: %w", err)
	}

	// Block dangerous top-level keys to prevent privilege escalation
	blockedKeys := []string{"apiVersion", "kind", "metadata", "status"}
	for _, key := range blockedKeys {
		if _, exists := overrides[key]; exists {
			return fmt.Errorf("overriding %q is not allowed", key)
		}
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
