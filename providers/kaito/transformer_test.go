package kaito

import (
	"context"
	"testing"

	kubeairunwayv1alpha1 "github.com/kaito-project/kubeairunway/controller/api/v1alpha1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
)

func newTestMD(name, namespace string) *kubeairunwayv1alpha1.ModelDeployment {
	return &kubeairunwayv1alpha1.ModelDeployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
			UID:       types.UID("test-uid"),
		},
		Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
			Model: kubeairunwayv1alpha1.ModelSpec{
				ID:     "meta-llama/Llama-2-7b-chat-hf",
				Source: kubeairunwayv1alpha1.ModelSourceHuggingFace,
			},
			Engine: kubeairunwayv1alpha1.EngineSpec{
				Type: kubeairunwayv1alpha1.EngineTypeVLLM,
			},
		},
	}
}

func TestTransformVLLM(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resources) != 1 {
		t.Fatalf("expected 1 resource, got %d", len(resources))
	}

	ws := resources[0]
	if ws.GetKind() != WorkspaceKind {
		t.Errorf("expected kind %s, got %s", WorkspaceKind, ws.GetKind())
	}
	if ws.GetName() != "test-model" {
		t.Errorf("expected name 'test-model', got %s", ws.GetName())
	}
	if ws.GetNamespace() != "default" {
		t.Errorf("expected namespace 'default', got %s", ws.GetNamespace())
	}
	if ws.GetAPIVersion() != "kaito.sh/v1beta1" {
		t.Errorf("expected apiVersion 'kaito.sh/v1beta1', got %s", ws.GetAPIVersion())
	}

	// Check owner references
	ownerRefs := ws.GetOwnerReferences()
	if len(ownerRefs) != 1 {
		t.Fatalf("expected 1 owner reference, got %d", len(ownerRefs))
	}
	if ownerRefs[0].Name != "test-model" {
		t.Errorf("expected owner ref name 'test-model', got %s", ownerRefs[0].Name)
	}

	// Check labels
	labels := ws.GetLabels()
	if labels["kubeairunway.ai/managed-by"] != "kubeairunway" {
		t.Errorf("expected managed-by label 'kubeairunway', got %s", labels["kubeairunway.ai/managed-by"])
	}
	if labels["kubeairunway.ai/engine-type"] != "vllm" {
		t.Errorf("expected engine-type label 'vllm', got %s", labels["kubeairunway.ai/engine-type"])
	}

	// Check inference preset for vLLM
	inference, _, _ := unstructured.NestedMap(ws.Object, "inference")
	preset, ok := inference["preset"].(map[string]interface{})
	if !ok {
		t.Fatal("expected inference.preset to be a map")
	}
	if preset["name"] != "meta-llama/Llama-2-7b-chat-hf" {
		t.Errorf("expected preset name to be model ID, got %v", preset["name"])
	}

	// Check resource count default
	resource, _, _ := unstructured.NestedMap(ws.Object, "resource")
	count, ok := resource["count"]
	if !ok {
		t.Fatal("expected resource.count")
	}
	if count != int64(1) {
		t.Errorf("expected default count 1, got %v", count)
	}
}

func TestTransformVLLMWithScaling(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Scaling = &kubeairunwayv1alpha1.ScalingSpec{
		Replicas: 3,
	}

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ws := resources[0]
	resource, _, _ := unstructured.NestedMap(ws.Object, "resource")
	if resource["count"] != int64(3) {
		t.Errorf("expected count 3, got %v", resource["count"])
	}
}

func TestTransformLlamaCpp(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeLlamaCpp
	md.Spec.Image = "my-image:latest"
	md.Spec.Model.ServedName = "my-model"

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ws := resources[0]
	inference, _, _ := unstructured.NestedMap(ws.Object, "inference")

	// Should have template instead of preset
	if _, ok := inference["preset"]; ok {
		t.Error("llamacpp should not have preset")
	}
	template, ok := inference["template"].(map[string]interface{})
	if !ok {
		t.Fatal("expected inference.template to be a map")
	}

	// Check container details
	spec, _ := template["spec"].(map[string]interface{})
	containers, _ := spec["containers"].([]interface{})
	if len(containers) != 1 {
		t.Fatalf("expected 1 container, got %d", len(containers))
	}

	container, _ := containers[0].(map[string]interface{})
	if container["image"] != "my-image:latest" {
		t.Errorf("expected image 'my-image:latest', got %v", container["image"])
	}

	// Check args include model ID and served name
	args, _ := container["args"].([]interface{})
	foundModel := false
	foundServed := false
	for _, a := range args {
		s, _ := a.(string)
		if s == "huggingface://meta-llama/Llama-2-7b-chat-hf" {
			foundModel = true
		}
		if s == "--served-model-name=my-model" {
			foundServed = true
		}
	}
	if !foundModel {
		t.Error("expected model URL in args")
	}
	if !foundServed {
		t.Error("expected --served-model-name in args")
	}

	// Check port
	ports, _ := container["ports"].([]interface{})
	if len(ports) != 1 {
		t.Fatalf("expected 1 port, got %d", len(ports))
	}
	port, _ := ports[0].(map[string]interface{})
	if port["containerPort"] != int64(DefaultLlamaCppPort) {
		t.Errorf("expected port %d, got %v", DefaultLlamaCppPort, port["containerPort"])
	}
}

func TestTransformLlamaCppNoImage(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeLlamaCpp
	// No image set

	_, err := tr.Transform(context.Background(), md)
	if err == nil {
		t.Fatal("expected error for llamacpp without image")
	}
}

func TestTransformUnsupportedEngine(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeSGLang

	_, err := tr.Transform(context.Background(), md)
	if err == nil {
		t.Fatal("expected error for unsupported engine")
	}
}

func TestTransformWithNodeSelector(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.NodeSelector = map[string]string{
		"gpu-type": "a100",
	}

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ws := resources[0]
	resource, _, _ := unstructured.NestedMap(ws.Object, "resource")
	ls, _ := resource["labelSelector"].(map[string]interface{})
	ml, _ := ls["matchLabels"].(map[string]interface{})
	if ml["gpu-type"] != "a100" {
		t.Errorf("expected nodeSelector in labelSelector matchLabels, got %v", ml)
	}
	if ml["kubernetes.io/os"] != "linux" {
		t.Error("expected default kubernetes.io/os=linux label")
	}
}

func TestTransformWithEnvVars(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeLlamaCpp
	md.Spec.Image = "my-image:latest"
	md.Spec.Env = []corev1.EnvVar{
		{Name: "FOO", Value: "bar"},
	}
	md.Spec.Secrets = &kubeairunwayv1alpha1.SecretsSpec{
		HuggingFaceToken: "my-hf-secret",
	}

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ws := resources[0]
	inference, _, _ := unstructured.NestedMap(ws.Object, "inference")
	template, _ := inference["template"].(map[string]interface{})
	spec, _ := template["spec"].(map[string]interface{})
	containers, _ := spec["containers"].([]interface{})
	container, _ := containers[0].(map[string]interface{})
	envVars, _ := container["env"].([]interface{})

	if len(envVars) != 2 {
		t.Fatalf("expected 2 env vars, got %d", len(envVars))
	}

	// Check user env
	env0, _ := envVars[0].(map[string]interface{})
	if env0["name"] != "FOO" || env0["value"] != "bar" {
		t.Errorf("expected FOO=bar, got %v", env0)
	}

	// Check HF_TOKEN
	env1, _ := envVars[1].(map[string]interface{})
	if env1["name"] != "HF_TOKEN" {
		t.Errorf("expected HF_TOKEN env var, got %v", env1)
	}
}

func TestTransformWithEnvFromSecret(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeLlamaCpp
	md.Spec.Image = "my-image:latest"
	md.Spec.Env = []corev1.EnvVar{
		{
			Name: "SECRET_VAL",
			ValueFrom: &corev1.EnvVarSource{
				SecretKeyRef: &corev1.SecretKeySelector{
					LocalObjectReference: corev1.LocalObjectReference{Name: "my-secret"},
					Key:                  "my-key",
				},
			},
		},
	}

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ws := resources[0]
	inference, _, _ := unstructured.NestedMap(ws.Object, "inference")
	template, _ := inference["template"].(map[string]interface{})
	spec, _ := template["spec"].(map[string]interface{})
	containers, _ := spec["containers"].([]interface{})
	container, _ := containers[0].(map[string]interface{})
	envVars, _ := container["env"].([]interface{})

	if len(envVars) != 1 {
		t.Fatalf("expected 1 env var, got %d", len(envVars))
	}

	env0, _ := envVars[0].(map[string]interface{})
	if env0["name"] != "SECRET_VAL" {
		t.Errorf("expected SECRET_VAL, got %v", env0["name"])
	}
	valueFrom, _ := env0["valueFrom"].(map[string]interface{})
	secretRef, _ := valueFrom["secretKeyRef"].(map[string]interface{})
	if secretRef["name"] != "my-secret" || secretRef["key"] != "my-key" {
		t.Errorf("expected secretKeyRef name=my-secret key=my-key, got %v", secretRef)
	}
}

func TestTransformWithResources(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeLlamaCpp
	md.Spec.Image = "my-image:latest"
	md.Spec.Resources = &kubeairunwayv1alpha1.ResourceSpec{
		Memory: "16Gi",
		CPU:    "4",
	}

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ws := resources[0]
	inference, _, _ := unstructured.NestedMap(ws.Object, "inference")
	template, _ := inference["template"].(map[string]interface{})
	spec, _ := template["spec"].(map[string]interface{})
	containers, _ := spec["containers"].([]interface{})
	container, _ := containers[0].(map[string]interface{})
	res, _ := container["resources"].(map[string]interface{})
	requests, _ := res["requests"].(map[string]interface{})

	if requests["memory"] != "16Gi" {
		t.Errorf("expected memory 16Gi, got %v", requests["memory"])
	}
	if requests["cpu"] != "4" {
		t.Errorf("expected cpu 4, got %v", requests["cpu"])
	}
}

func TestTransformWithPodTemplateLabels(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.PodTemplate = &kubeairunwayv1alpha1.PodTemplateSpec{
		Metadata: &kubeairunwayv1alpha1.PodTemplateMetadata{
			Labels: map[string]string{
				"custom-label": "custom-value",
			},
			Annotations: map[string]string{
				"custom-annotation": "custom-value",
			},
		},
	}

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ws := resources[0]
	labels := ws.GetLabels()
	if labels["custom-label"] != "custom-value" {
		t.Errorf("expected custom-label in labels")
	}

	annotations := ws.GetAnnotations()
	if annotations["custom-annotation"] != "custom-value" {
		t.Errorf("expected custom-annotation in annotations")
	}
}

func TestBuildResourceRequests(t *testing.T) {
	tr := NewTransformer()

	// Nil spec
	result := tr.buildResourceRequests(nil)
	if result != nil {
		t.Errorf("expected nil for nil spec, got %v", result)
	}

	// Empty spec
	result = tr.buildResourceRequests(&kubeairunwayv1alpha1.ResourceSpec{})
	if result != nil {
		t.Errorf("expected nil for empty spec, got %v", result)
	}

	// Only memory
	result = tr.buildResourceRequests(&kubeairunwayv1alpha1.ResourceSpec{Memory: "8Gi"})
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	requests, _ := result["requests"].(map[string]interface{})
	if requests["memory"] != "8Gi" {
		t.Errorf("expected memory 8Gi, got %v", requests["memory"])
	}

	// Both
	result = tr.buildResourceRequests(&kubeairunwayv1alpha1.ResourceSpec{Memory: "8Gi", CPU: "2"})
	requests, _ = result["requests"].(map[string]interface{})
	if requests["cpu"] != "2" {
		t.Errorf("expected cpu 2, got %v", requests["cpu"])
	}
}

func TestSanitizeLabelValue(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"simple", "simple"},
		{"with spaces", "with-spaces"},
		{"with/slashes", "with-slashes"},
		{"with:colons", "with-colons"},
		{"-leading-dash", "leading-dash"},
		{"trailing-dash-", "trailing-dash"},
		{"a.b-c_d", "a.b-c_d"},
		{"", ""},
		{
			"this-is-a-very-long-label-value-that-exceeds-the-sixty-three-character-limit",
			"this-is-a-very-long-label-value-that-exceeds-the-sixty-three-ch",
		},
	}

	for _, tt := range tests {
		result := sanitizeLabelValue(tt.input)
		if result != tt.expected {
			t.Errorf("sanitizeLabelValue(%q) = %q, expected %q", tt.input, result, tt.expected)
		}
	}
}

func TestBoolPtr(t *testing.T) {
	truePtr := boolPtr(true)
	if *truePtr != true {
		t.Error("expected true")
	}
	falsePtr := boolPtr(false)
	if *falsePtr != false {
		t.Error("expected false")
	}
}

func TestBuildEnvVarsEmpty(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test", "default")
	result := tr.buildEnvVars(md)
	if len(result) != 0 {
		t.Errorf("expected empty env vars, got %d", len(result))
	}
}

func TestApplyOverrides(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")

	// No overrides - should succeed without changes
	results, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	ws := results[0]

	resource, _, _ := unstructured.NestedMap(ws.Object, "resource")
	if resource == nil {
		t.Fatal("expected resource to be set")
	}

	// With overrides - should merge into workspace
	md.Spec.Provider = &kubeairunwayv1alpha1.ProviderSpec{
		Overrides: &runtime.RawExtension{
			Raw: []byte(`{
				"resource": {
					"labelSelector": {"matchLabels": {"custom": "label"}}
				},
				"inference": {
					"preset": {"accessMode": "private"}
				}
			}`),
		},
	}

	results, err = tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	ws = results[0]

	// Verify overrides were merged
	accessMode, found, _ := unstructured.NestedString(ws.Object, "inference", "preset", "accessMode")
	if !found || accessMode != "private" {
		t.Errorf("expected accessMode 'private', got %q (found=%v)", accessMode, found)
	}

	// Verify existing fields are preserved (resource.count should still be set)
	count, found, _ := unstructured.NestedInt64(ws.Object, "resource", "count")
	if !found || count == 0 {
		t.Error("expected resource.count to be preserved after override merge")
	}

	// Verify override was merged into resource
	customLabel, found, _ := unstructured.NestedString(ws.Object, "resource", "labelSelector", "matchLabels", "custom")
	if !found || customLabel != "label" {
		t.Errorf("expected custom label 'label', got %q (found=%v)", customLabel, found)
	}
}

func TestApplyOverridesInvalidJSON(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Provider = &kubeairunwayv1alpha1.ProviderSpec{
		Overrides: &runtime.RawExtension{
			Raw: []byte("not valid json"),
		},
	}

	_, err := tr.Transform(context.Background(), md)
	if err == nil {
		t.Fatal("expected error for invalid JSON overrides")
	}
}

func TestTransformVLLMDefaultReplicas(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	// No Scaling spec at all — should default to count=1

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ws := resources[0]
	count, found, _ := unstructured.NestedInt64(ws.Object, "resource", "count")
	if !found || count != 1 {
		t.Errorf("expected default count 1, got %v (found=%v)", count, found)
	}
}

func TestTransformVLLMZeroReplicas(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Scaling = &kubeairunwayv1alpha1.ScalingSpec{
		Replicas: 0,
	}

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ws := resources[0]
	// When replicas is 0, should still default to 1
	count, found, _ := unstructured.NestedInt64(ws.Object, "resource", "count")
	if !found || count != 1 {
		t.Errorf("expected default count 1 for zero replicas, got %v", count)
	}
}

func TestTransformLlamaCppWithServedName(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeLlamaCpp
	md.Spec.Image = "my-image:latest"
	md.Spec.Model.ServedName = "my-alias"

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ws := resources[0]
	containers, found, _ := unstructured.NestedSlice(ws.Object, "inference", "template", "spec", "containers")
	if !found || len(containers) == 0 {
		t.Fatal("expected containers in template")
	}
	container := containers[0].(map[string]interface{})
	args, _ := container["args"].([]interface{})
	foundServedName := false
	for _, a := range args {
		if a.(string) == "--served-model-name=my-alias" {
			foundServedName = true
		}
	}
	if !foundServedName {
		t.Errorf("expected --served-model-name in args, got %v", args)
	}
}

func TestTransformEmptyNodeSelector(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.NodeSelector = map[string]string{}

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ws := resources[0]
	matchLabels, found, _ := unstructured.NestedStringMap(ws.Object, "resource", "labelSelector", "matchLabels")
	if !found {
		t.Fatal("expected matchLabels")
	}
	if matchLabels["kubernetes.io/os"] != "linux" {
		t.Error("expected kubernetes.io/os=linux in default matchLabels")
	}
	if len(matchLabels) != 1 {
		t.Errorf("expected only 1 matchLabel (os=linux), got %d: %v", len(matchLabels), matchLabels)
	}
}

func TestTransformSGLangUnsupported(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeSGLang

	_, err := tr.Transform(context.Background(), md)
	if err == nil {
		t.Fatal("expected error for unsupported SGLang engine")
	}
}

func TestTransformTRTLLMUnsupported(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeTRTLLM

	_, err := tr.Transform(context.Background(), md)
	if err == nil {
		t.Fatal("expected error for unsupported TRT-LLM engine")
	}
}

func TestTransformWithNilResources(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeLlamaCpp
	md.Spec.Image = "my-image:latest"
	md.Spec.Resources = nil

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ws := resources[0]
	containers, found, _ := unstructured.NestedSlice(ws.Object, "inference", "template", "spec", "containers")
	if !found || len(containers) == 0 {
		t.Fatal("expected containers in template")
	}
	container := containers[0].(map[string]interface{})
	// No resources should be set
	if _, ok := container["resources"]; ok {
		t.Error("expected no resources when spec.resources is nil")
	}
}

func TestTransformWithHFSecret(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeLlamaCpp
	md.Spec.Image = "my-image:latest"
	md.Spec.Secrets = &kubeairunwayv1alpha1.SecretsSpec{
		HuggingFaceToken: "my-hf-secret",
	}

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ws := resources[0]
	containers, found, _ := unstructured.NestedSlice(ws.Object, "inference", "template", "spec", "containers")
	if !found || len(containers) == 0 {
		t.Fatal("expected containers in template")
	}
	container := containers[0].(map[string]interface{})
	envVars, _ := container["env"].([]interface{})
	foundHFToken := false
	for _, ev := range envVars {
		e, _ := ev.(map[string]interface{})
		if e["name"] == "HF_TOKEN" {
			foundHFToken = true
			vf, _ := e["valueFrom"].(map[string]interface{})
			skr, _ := vf["secretKeyRef"].(map[string]interface{})
			if skr["name"] != "my-hf-secret" {
				t.Errorf("expected secret name 'my-hf-secret', got %v", skr["name"])
			}
		}
	}
	if !foundHFToken {
		t.Error("expected HF_TOKEN env var")
	}
}

func TestTransformOverrideCanSetRootFields(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Provider = &kubeairunwayv1alpha1.ProviderSpec{
		Overrides: &runtime.RawExtension{
			Raw: []byte(`{
				"resource": {
					"count": 10
				}
			}`),
		},
	}

	results, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ws := results[0]
	// Overrides should set resource.count (KAITO has resource at root level)
	count, found, _ := unstructured.NestedFloat64(ws.Object, "resource", "count")
	if !found || count != 10 {
		t.Errorf("expected overridden count 10, got %v", count)
	}
	// labelSelector should still be present (deep merge preserves it)
	_, found, _ = unstructured.NestedMap(ws.Object, "resource", "labelSelector")
	if !found {
		t.Error("expected labelSelector to be preserved after override merge")
	}
}

func TestBuildResourceRequestsGPUOnly(t *testing.T) {
	tr := NewTransformer()
	// GPU-only spec — KAITO buildResourceRequests doesn't handle GPU
	result := tr.buildResourceRequests(&kubeairunwayv1alpha1.ResourceSpec{
		GPU: &kubeairunwayv1alpha1.GPUSpec{Count: 4},
	})
	if result != nil {
		t.Errorf("expected nil when only GPU is specified (KAITO doesn't put GPU in requests), got %v", result)
	}
}

func TestTransformPreservesOwnerReference(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.APIVersion = "kubeairunway.ai/v1alpha1"
	md.Kind = "ModelDeployment"

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ws := resources[0]
	ownerRefs := ws.GetOwnerReferences()
	if len(ownerRefs) != 1 {
		t.Fatalf("expected 1 owner reference, got %d", len(ownerRefs))
	}
	if ownerRefs[0].Name != "test-model" {
		t.Errorf("expected owner ref name 'test-model', got %s", ownerRefs[0].Name)
	}
	if *ownerRefs[0].Controller != true {
		t.Error("expected controller=true on owner ref")
	}
}
