package dynamo

import (
	"context"
	"encoding/json"
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
			Resources: &kubeairunwayv1alpha1.ResourceSpec{
				GPU: &kubeairunwayv1alpha1.GPUSpec{
					Count: 1,
				},
			},
		},
	}
}

func TestTransformAggregated(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resources) != 1 {
		t.Fatalf("expected 1 resource, got %d", len(resources))
	}

	dgd := resources[0]
	if dgd.GetKind() != DynamoGraphDeploymentKind {
		t.Errorf("expected kind %s, got %s", DynamoGraphDeploymentKind, dgd.GetKind())
	}
	if dgd.GetName() != "test-model" {
		t.Errorf("expected name 'test-model', got %s", dgd.GetName())
	}
	if dgd.GetAPIVersion() != "nvidia.com/v1alpha1" {
		t.Errorf("expected apiVersion 'nvidia.com/v1alpha1', got %s", dgd.GetAPIVersion())
	}

	// Check namespace
	if dgd.GetNamespace() != DynamoNamespace {
		t.Errorf("expected namespace %q, got %q", DynamoNamespace, dgd.GetNamespace())
	}

	// Check labels
	labels := dgd.GetLabels()
	if labels["kubeairunway.ai/managed-by"] != "kubeairunway" {
		t.Errorf("expected managed-by label 'kubeairunway'")
	}
	if labels["kubeairunway.ai/deployment-namespace"] != "default" {
		t.Errorf("expected deployment-namespace label 'default'")
	}
	if labels["kubeairunway.ai/engine-type"] != "vllm" {
		t.Errorf("expected engine-type label 'vllm'")
	}

	// Check spec
	spec, _, _ := unstructured.NestedMap(dgd.Object, "spec")
	if spec["backendFramework"] != "vllm" {
		t.Errorf("expected backendFramework 'vllm', got %v", spec["backendFramework"])
	}

	services, _ := spec["services"].(map[string]interface{})
	if _, ok := services["Frontend"]; !ok {
		t.Error("expected Frontend service")
	}
	if _, ok := services["VllmWorker"]; !ok {
		t.Error("expected VllmWorker service in aggregated mode")
	}
}

func TestTransformDisaggregated(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Serving = &kubeairunwayv1alpha1.ServingSpec{
		Mode: kubeairunwayv1alpha1.ServingModeDisaggregated,
	}
	md.Spec.Scaling = &kubeairunwayv1alpha1.ScalingSpec{
		Prefill: &kubeairunwayv1alpha1.ComponentScalingSpec{
			Replicas: 2,
			GPU:      &kubeairunwayv1alpha1.GPUSpec{Count: 2, Type: "nvidia.com/gpu"},
			Memory:   "64Gi",
		},
		Decode: &kubeairunwayv1alpha1.ComponentScalingSpec{
			Replicas: 3,
			GPU:      &kubeairunwayv1alpha1.GPUSpec{Count: 1, Type: "nvidia.com/gpu"},
			Memory:   "32Gi",
		},
	}

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	dgd := resources[0]
	spec, _, _ := unstructured.NestedMap(dgd.Object, "spec")
	services, _ := spec["services"].(map[string]interface{})

	// Disaggregated mode should have prefill and decode workers, not VllmWorker
	if _, ok := services["VllmWorker"]; ok {
		t.Error("did not expect VllmWorker in disaggregated mode")
	}
	if _, ok := services["VllmPrefillWorker"]; !ok {
		t.Error("expected VllmPrefillWorker in disaggregated mode")
	}
	if _, ok := services["VllmDecodeWorker"]; !ok {
		t.Error("expected VllmDecodeWorker in disaggregated mode")
	}

	// Check prefill worker
	prefill, _ := services["VllmPrefillWorker"].(map[string]interface{})
	if prefill["replicas"] != int64(2) {
		t.Errorf("expected prefill replicas 2, got %v", prefill["replicas"])
	}
	if prefill["subComponentType"] != SubComponentTypePrefill {
		t.Errorf("expected subComponentType '%s', got %v", SubComponentTypePrefill, prefill["subComponentType"])
	}

	// Check decode worker
	decode, _ := services["VllmDecodeWorker"].(map[string]interface{})
	if decode["replicas"] != int64(3) {
		t.Errorf("expected decode replicas 3, got %v", decode["replicas"])
	}
}

func TestMapEngineType(t *testing.T) {
	tr := NewTransformer()

	tests := []struct {
		input    kubeairunwayv1alpha1.EngineType
		expected string
	}{
		{kubeairunwayv1alpha1.EngineTypeVLLM, "vllm"},
		{kubeairunwayv1alpha1.EngineTypeSGLang, "sglang"},
		{kubeairunwayv1alpha1.EngineTypeTRTLLM, "trtllm"},
		{kubeairunwayv1alpha1.EngineType("unknown"), "unknown"},
	}

	for _, tt := range tests {
		result := tr.mapEngineType(tt.input)
		if result != tt.expected {
			t.Errorf("mapEngineType(%s) = %s, expected %s", tt.input, result, tt.expected)
		}
	}
}

func TestGetImage(t *testing.T) {
	tr := NewTransformer()

	// Custom image
	md := newTestMD("test", "default")
	md.Spec.Image = "custom-image:v1"
	if img := tr.getImage(md); img != "custom-image:v1" {
		t.Errorf("expected custom image, got %s", img)
	}

	// Default vLLM image
	md.Spec.Image = ""
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeVLLM
	if img := tr.getImage(md); img != "nvcr.io/nvidia/ai-dynamo/vllm-runtime:0.7.1" {
		t.Errorf("expected default vllm image, got %s", img)
	}

	// Default SGLang image
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeSGLang
	if img := tr.getImage(md); img != "nvcr.io/nvidia/ai-dynamo/sglang-runtime:0.7.1" {
		t.Errorf("expected default sglang image, got %s", img)
	}

	// Default TRT-LLM image
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeTRTLLM
	if img := tr.getImage(md); img != "nvcr.io/nvidia/ai-dynamo/trtllm-runtime:0.7.1" {
		t.Errorf("expected default trtllm image, got %s", img)
	}

	// Unknown engine → fallback
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineType("unknown")
	if img := tr.getImage(md); img != "nvcr.io/nvidia/ai-dynamo/vllm-runtime:0.7.1" {
		t.Errorf("expected fallback to vllm image, got %s", img)
	}
}

func TestBuildEngineArgs(t *testing.T) {
	tr := NewTransformer()

	// Basic vLLM
	md := newTestMD("test", "default")
	args := tr.buildEngineArgs(md)
	if args != "python3 -m dynamo.vllm --model meta-llama/Llama-2-7b-chat-hf" {
		t.Errorf("unexpected args: %s", args)
	}

	// SGLang with context length
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeSGLang
	ctxLen := int32(4096)
	md.Spec.Engine.ContextLength = &ctxLen
	args = tr.buildEngineArgs(md)
	if args != "python3 -m dynamo.sglang --model meta-llama/Llama-2-7b-chat-hf --context-length 4096" {
		t.Errorf("unexpected args: %s", args)
	}

	// vLLM with context length
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeVLLM
	args = tr.buildEngineArgs(md)
	if args != "python3 -m dynamo.vllm --model meta-llama/Llama-2-7b-chat-hf --max-model-len 4096" {
		t.Errorf("unexpected args: %s", args)
	}

	// TRT-LLM
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeTRTLLM
	md.Spec.Engine.ContextLength = nil
	args = tr.buildEngineArgs(md)
	if args != "python3 -m dynamo.trtllm --model meta-llama/Llama-2-7b-chat-hf" {
		t.Errorf("unexpected args: %s", args)
	}

	// With served name and trust remote code
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeVLLM
	md.Spec.Model.ServedName = "my-model"
	md.Spec.Engine.TrustRemoteCode = true
	args = tr.buildEngineArgs(md)
	expectedParts := []string{"--served-model-name", "my-model", "--trust-remote-code"}
	for _, part := range expectedParts {
		if !containsStr(args, part) {
			t.Errorf("expected args to contain '%s', got: %s", part, args)
		}
	}
}

func containsStr(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSubstring(s, substr))
}

func containsSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func TestBuildResourceLimits(t *testing.T) {
	tr := NewTransformer()

	// Nil spec
	result := tr.buildResourceLimits(nil)
	limits, _ := result["limits"].(map[string]interface{})
	if len(limits) != 0 {
		t.Errorf("expected empty limits for nil spec")
	}

	// With GPU
	result = tr.buildResourceLimits(&kubeairunwayv1alpha1.ResourceSpec{
		GPU: &kubeairunwayv1alpha1.GPUSpec{Count: 4, Type: "nvidia.com/gpu"},
	})
	limits, _ = result["limits"].(map[string]interface{})
	if limits["gpu"] != "4" {
		t.Errorf("expected gpu limit 4, got %v", limits["gpu"])
	}
	requests, _ := result["requests"].(map[string]interface{})
	if requests["gpu"] != "4" {
		t.Errorf("expected gpu request 4, got %v", requests["gpu"])
	}

	// With custom GPU type (Dynamo always uses 'gpu' key)
	result = tr.buildResourceLimits(&kubeairunwayv1alpha1.ResourceSpec{
		GPU: &kubeairunwayv1alpha1.GPUSpec{Count: 2, Type: "amd.com/gpu"},
	})
	limits, _ = result["limits"].(map[string]interface{})
	if limits["gpu"] != "2" {
		t.Errorf("expected gpu limit 2, got %v", limits["gpu"])
	}

	// With memory and CPU
	result = tr.buildResourceLimits(&kubeairunwayv1alpha1.ResourceSpec{
		Memory: "32Gi",
		CPU:    "8",
	})
	limits, _ = result["limits"].(map[string]interface{})
	if limits["memory"] != "32Gi" {
		t.Errorf("expected memory 32Gi, got %v", limits["memory"])
	}
	if limits["cpu"] != "8" {
		t.Errorf("expected cpu 8, got %v", limits["cpu"])
	}
}

func TestParseOverrides(t *testing.T) {
	tr := NewTransformer()

	// No overrides
	md := newTestMD("test", "default")
	overrides, err := tr.parseOverrides(md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if overrides.RouterMode != "" {
		t.Errorf("expected empty router mode, got %s", overrides.RouterMode)
	}

	// With overrides
	overrideData := DynamoOverrides{
		RouterMode: "kv",
		Frontend: &FrontendOverrides{
			Replicas: int32Ptr(3),
			Resources: &ResourceOverrides{
				CPU:    "4",
				Memory: "8Gi",
			},
		},
	}
	raw, _ := json.Marshal(overrideData)
	md.Spec.Provider = &kubeairunwayv1alpha1.ProviderSpec{
		Name:      "dynamo",
		Overrides: &runtime.RawExtension{Raw: raw},
	}

	overrides, err = tr.parseOverrides(md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if overrides.RouterMode != "kv" {
		t.Errorf("expected router mode 'kv', got %s", overrides.RouterMode)
	}
	if *overrides.Frontend.Replicas != 3 {
		t.Errorf("expected frontend replicas 3, got %d", *overrides.Frontend.Replicas)
	}

	// Invalid overrides
	md.Spec.Provider.Overrides = &runtime.RawExtension{Raw: []byte("invalid json")}
	_, err = tr.parseOverrides(md)
	if err == nil {
		t.Fatal("expected error for invalid overrides")
	}
}

func int32Ptr(i int32) *int32 {
	return &i
}

func TestBuildFrontendService(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test", "default")

	// Default frontend
	frontend := tr.buildFrontendService(md, &DynamoOverrides{})
	if frontend["replicas"] != int64(DefaultFrontendReplicas) {
		t.Errorf("expected default replicas, got %v", frontend["replicas"])
	}
	if frontend["router-mode"] != DefaultRouterMode {
		t.Errorf("expected default router mode, got %v", frontend["router-mode"])
	}

	// With overrides
	overrides := &DynamoOverrides{
		RouterMode: "kv",
		Frontend: &FrontendOverrides{
			Replicas: int32Ptr(5),
			Resources: &ResourceOverrides{
				CPU:    "8",
				Memory: "16Gi",
			},
		},
	}
	frontend = tr.buildFrontendService(md, overrides)
	if frontend["replicas"] != int64(5) {
		t.Errorf("expected replicas 5, got %v", frontend["replicas"])
	}
	if frontend["router-mode"] != "kv" {
		t.Errorf("expected router-mode 'kv', got %v", frontend["router-mode"])
	}
}

func TestBuildFrontendWithSecret(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test", "default")
	md.Spec.Secrets = &kubeairunwayv1alpha1.SecretsSpec{
		HuggingFaceToken: "my-hf-secret",
	}

	frontend := tr.buildFrontendService(md, &DynamoOverrides{})
	if frontend["envFromSecret"] != "my-hf-secret" {
		t.Errorf("expected envFromSecret 'my-hf-secret', got %v", frontend["envFromSecret"])
	}
}

func TestBuildAggregatedWorker(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test", "default")
	md.Spec.Scaling = &kubeairunwayv1alpha1.ScalingSpec{Replicas: 2}

	worker := tr.buildAggregatedWorker(md, "test-image:v1")
	if worker["replicas"] != int64(2) {
		t.Errorf("expected replicas 2, got %v", worker["replicas"])
	}
	if worker["componentType"] != ComponentTypeWorker {
		t.Errorf("expected componentType '%s', got %v", ComponentTypeWorker, worker["componentType"])
	}

	extraPodSpec, _ := worker["extraPodSpec"].(map[string]interface{})
	mainContainer, _ := extraPodSpec["mainContainer"].(map[string]interface{})
	if mainContainer["image"] != "test-image:v1" {
		t.Errorf("expected image 'test-image:v1', got %v", mainContainer["image"])
	}
}

func TestBuildAggregatedWorkerWithSecret(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test", "default")
	md.Spec.Secrets = &kubeairunwayv1alpha1.SecretsSpec{HuggingFaceToken: "hf-secret"}

	worker := tr.buildAggregatedWorker(md, "img")
	if worker["envFromSecret"] != "hf-secret" {
		t.Errorf("expected envFromSecret, got %v", worker["envFromSecret"])
	}
}

func TestAddSchedulingConfig(t *testing.T) {
	tr := NewTransformer()

	// With node selector
	md := newTestMD("test", "default")
	md.Spec.NodeSelector = map[string]string{"gpu": "a100"}
	service := map[string]interface{}{
		"extraPodSpec": map[string]interface{}{},
	}
	tr.addSchedulingConfig(service, md)
	eps, _ := service["extraPodSpec"].(map[string]interface{})
	ns, _ := eps["nodeSelector"].(map[string]string)
	if ns["gpu"] != "a100" {
		t.Errorf("expected nodeSelector gpu=a100")
	}

	// With tolerations
	md.Spec.Tolerations = []corev1.Toleration{
		{
			Key:      "nvidia.com/gpu",
			Operator: corev1.TolerationOpExists,
			Effect:   corev1.TaintEffectNoSchedule,
		},
	}
	service = map[string]interface{}{}
	tr.addSchedulingConfig(service, md)
	eps, _ = service["extraPodSpec"].(map[string]interface{})
	tolerations, _ := eps["tolerations"].([]interface{})
	if len(tolerations) != 1 {
		t.Fatalf("expected 1 toleration, got %d", len(tolerations))
	}

	// With toleration value and tolerationSeconds
	secs := int64(300)
	md.Spec.Tolerations = []corev1.Toleration{
		{
			Key:               "node.kubernetes.io/not-ready",
			Operator:          corev1.TolerationOpEqual,
			Value:             "true",
			Effect:            corev1.TaintEffectNoExecute,
			TolerationSeconds: &secs,
		},
	}
	service = map[string]interface{}{}
	tr.addSchedulingConfig(service, md)
	eps, _ = service["extraPodSpec"].(map[string]interface{})
	tolerations, _ = eps["tolerations"].([]interface{})
	tol, _ := tolerations[0].(map[string]interface{})
	if tol["value"] != "true" {
		t.Errorf("expected toleration value 'true', got %v", tol["value"])
	}
	if tol["tolerationSeconds"] != int64(300) {
		t.Errorf("expected tolerationSeconds 300, got %v", tol["tolerationSeconds"])
	}
}

func TestSanitizeLabelValue(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"simple", "simple"},
		{"with/slashes", "with-slashes"},
		{"-leading", "leading"},
		{"trailing-", "trailing"},
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
	p := boolPtr(true)
	if *p != true {
		t.Error("expected true")
	}
}

func TestBuildPrefillWorkerWithSecret(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test", "default")
	md.Spec.Secrets = &kubeairunwayv1alpha1.SecretsSpec{HuggingFaceToken: "hf-secret"}
	md.Spec.Scaling = &kubeairunwayv1alpha1.ScalingSpec{
		Prefill: &kubeairunwayv1alpha1.ComponentScalingSpec{
			Replicas: 1,
			GPU:      &kubeairunwayv1alpha1.GPUSpec{Count: 1},
		},
	}

	worker := tr.buildPrefillWorker(md, "img")
	if worker["envFromSecret"] != "hf-secret" {
		t.Errorf("expected envFromSecret, got %v", worker["envFromSecret"])
	}
	// Check --is-prefill-worker flag in args
	eps, _ := worker["extraPodSpec"].(map[string]interface{})
	mc, _ := eps["mainContainer"].(map[string]interface{})
	args, _ := mc["args"].([]interface{})
	if len(args) != 1 {
		t.Fatalf("expected 1 arg string, got %d", len(args))
	}
	argStr, _ := args[0].(string)
	if !containsSubstring(argStr, "--is-prefill-worker") {
		t.Errorf("expected --is-prefill-worker in args: %s", argStr)
	}
}

func TestBuildDecodeWorkerWithSecret(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test", "default")
	md.Spec.Secrets = &kubeairunwayv1alpha1.SecretsSpec{HuggingFaceToken: "hf-secret"}
	md.Spec.Scaling = &kubeairunwayv1alpha1.ScalingSpec{
		Decode: &kubeairunwayv1alpha1.ComponentScalingSpec{
			Replicas: 2,
			GPU:      &kubeairunwayv1alpha1.GPUSpec{Count: 1, Type: "custom.gpu"},
			Memory:   "64Gi",
		},
	}

	worker := tr.buildDecodeWorker(md, "img")
	if worker["envFromSecret"] != "hf-secret" {
		t.Errorf("expected envFromSecret")
	}
	if worker["replicas"] != int64(2) {
		t.Errorf("expected replicas 2")
	}
}

func TestBuildEngineArgsWithCustomArgs(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test", "default")
	md.Spec.Engine.Args = map[string]string{
		"tensor-parallel-size": "4",
		"enable-prefix-caching": "",
	}

	args := tr.buildEngineArgs(md)
	if !containsSubstring(args, "--tensor-parallel-size 4") && !containsSubstring(args, "--tensor-parallel-size") {
		t.Errorf("expected --tensor-parallel-size in args: %s", args)
	}
}

func TestBuildEngineArgsTrustRemoteCodeSGLang(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeSGLang
	md.Spec.Engine.TrustRemoteCode = true

	args := tr.buildEngineArgs(md)
	if !containsSubstring(args, "--trust-remote-code") {
		t.Errorf("expected --trust-remote-code for sglang: %s", args)
	}
}

func TestBuildEngineArgsTRTLLMContextLength(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeTRTLLM
	ctxLen := int32(8192)
	md.Spec.Engine.ContextLength = &ctxLen

	args := tr.buildEngineArgs(md)
	// TRT-LLM doesn't use context length at runtime
	if containsSubstring(args, "8192") {
		t.Errorf("TRT-LLM should not include context length: %s", args)
	}
}

func TestBuildPrefillWorkerWithCustomGPUType(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test", "default")
	md.Spec.Scaling = &kubeairunwayv1alpha1.ScalingSpec{
		Prefill: &kubeairunwayv1alpha1.ComponentScalingSpec{
			Replicas: 1,
			GPU:      &kubeairunwayv1alpha1.GPUSpec{Count: 2, Type: "amd.com/gpu"},
			Memory:   "32Gi",
		},
	}

	worker := tr.buildPrefillWorker(md, "img")
	resources, _ := worker["resources"].(map[string]interface{})
	limits, _ := resources["limits"].(map[string]interface{})
	if limits["gpu"] != "2" {
		t.Errorf("expected gpu=2, got %v", limits["gpu"])
	}
	if limits["memory"] != "32Gi" {
		t.Errorf("expected memory=32Gi, got %v", limits["memory"])
	}
}

func TestApplyOverridesEscapeHatch(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")

	// Set overrides with both typed fields and arbitrary escape hatch fields
	md.Spec.Provider = &kubeairunwayv1alpha1.ProviderSpec{
		Name: "dynamo",
		Overrides: &runtime.RawExtension{
			Raw: []byte(`{
				"routerMode": "kv",
				"spec": {
					"customField": "customValue"
				}
			}`),
		},
	}

	results, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	dgd := results[0]

	// Verify the escape hatch field was merged into the output
	customField, found, _ := unstructured.NestedString(dgd.Object, "spec", "customField")
	if !found || customField != "customValue" {
		t.Errorf("expected customField 'customValue', got %q (found=%v)", customField, found)
	}

	// Verify existing spec fields are preserved (backendFramework should still be set)
	framework, found, _ := unstructured.NestedString(dgd.Object, "spec", "backendFramework")
	if !found || framework == "" {
		t.Error("expected backendFramework to be preserved after override merge")
	}
}

func TestTransformAggregatedNoGPU(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Resources = &kubeairunwayv1alpha1.ResourceSpec{
		Memory: "16Gi",
		CPU:    "4",
	}

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	dgd := resources[0]
	spec, _, _ := unstructured.NestedMap(dgd.Object, "spec")
	services, _ := spec["services"].(map[string]interface{})
	worker, _ := services["VllmWorker"].(map[string]interface{})
	res, _ := worker["resources"].(map[string]interface{})
	limits, _ := res["limits"].(map[string]interface{})
	requests, _ := res["requests"].(map[string]interface{})

	if _, ok := limits["gpu"]; ok {
		t.Error("expected no gpu in limits when GPU not specified")
	}
	if _, ok := requests["gpu"]; ok {
		t.Error("expected no gpu in requests when GPU not specified")
	}
	if limits["memory"] != "16Gi" {
		t.Errorf("expected memory=16Gi, got %v", limits["memory"])
	}
	if limits["cpu"] != "4" {
		t.Errorf("expected cpu=4, got %v", limits["cpu"])
	}
}

func TestTransformAggregatedNilResources(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Resources = nil

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	dgd := resources[0]
	spec, _, _ := unstructured.NestedMap(dgd.Object, "spec")
	services, _ := spec["services"].(map[string]interface{})
	worker, _ := services["VllmWorker"].(map[string]interface{})
	res, _ := worker["resources"].(map[string]interface{})
	limits, _ := res["limits"].(map[string]interface{})
	if len(limits) != 0 {
		t.Errorf("expected empty limits for nil resources, got %v", limits)
	}
}

func TestTransformAggregatedGPUCount0(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Resources = &kubeairunwayv1alpha1.ResourceSpec{
		GPU: &kubeairunwayv1alpha1.GPUSpec{Count: 0},
	}

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	dgd := resources[0]
	spec, _, _ := unstructured.NestedMap(dgd.Object, "spec")
	services, _ := spec["services"].(map[string]interface{})
	worker, _ := services["VllmWorker"].(map[string]interface{})
	res, _ := worker["resources"].(map[string]interface{})
	limits, _ := res["limits"].(map[string]interface{})
	if _, ok := limits["gpu"]; ok {
		t.Error("expected no gpu in limits when count is 0")
	}
}

func TestTransformSGLangEngine(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeSGLang

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	dgd := resources[0]
	spec, _, _ := unstructured.NestedMap(dgd.Object, "spec")
	if spec["backendFramework"] != "sglang" {
		t.Errorf("expected backendFramework 'sglang', got %v", spec["backendFramework"])
	}

	services, _ := spec["services"].(map[string]interface{})
	worker, _ := services["VllmWorker"].(map[string]interface{})
	eps, _ := worker["extraPodSpec"].(map[string]interface{})
	mc, _ := eps["mainContainer"].(map[string]interface{})
	argsSlice, _ := mc["args"].([]interface{})
	if len(argsSlice) == 0 {
		t.Fatal("expected engine args")
	}
	if !containsSubstring(argsSlice[0].(string), "dynamo.sglang") {
		t.Errorf("expected sglang runner in args, got %v", argsSlice[0])
	}
}

func TestTransformTRTLLMEngine(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeTRTLLM

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	dgd := resources[0]
	spec, _, _ := unstructured.NestedMap(dgd.Object, "spec")
	if spec["backendFramework"] != "trtllm" {
		t.Errorf("expected backendFramework 'trtllm', got %v", spec["backendFramework"])
	}
}

func TestTransformWithCustomScalingReplicas(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Scaling = &kubeairunwayv1alpha1.ScalingSpec{
		Replicas: 5,
	}

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	dgd := resources[0]
	spec, _, _ := unstructured.NestedMap(dgd.Object, "spec")
	services, _ := spec["services"].(map[string]interface{})
	worker, _ := services["VllmWorker"].(map[string]interface{})
	if worker["replicas"] != int64(5) {
		t.Errorf("expected replicas 5, got %v", worker["replicas"])
	}
}

func TestTransformDisaggregatedGPURequests(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Serving = &kubeairunwayv1alpha1.ServingSpec{
		Mode: kubeairunwayv1alpha1.ServingModeDisaggregated,
	}
	md.Spec.Scaling = &kubeairunwayv1alpha1.ScalingSpec{
		Prefill: &kubeairunwayv1alpha1.ComponentScalingSpec{
			Replicas: 1,
			GPU:      &kubeairunwayv1alpha1.GPUSpec{Count: 4},
		},
		Decode: &kubeairunwayv1alpha1.ComponentScalingSpec{
			Replicas: 1,
			GPU:      &kubeairunwayv1alpha1.GPUSpec{Count: 2},
		},
	}

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	dgd := resources[0]
	spec, _, _ := unstructured.NestedMap(dgd.Object, "spec")
	services, _ := spec["services"].(map[string]interface{})

	// Check prefill has both limits and requests
	prefill, _ := services["VllmPrefillWorker"].(map[string]interface{})
	prefillRes, _ := prefill["resources"].(map[string]interface{})
	prefillLimits, _ := prefillRes["limits"].(map[string]interface{})
	prefillRequests, _ := prefillRes["requests"].(map[string]interface{})
	if prefillLimits["gpu"] != "4" {
		t.Errorf("expected prefill gpu limit 4, got %v", prefillLimits["gpu"])
	}
	if prefillRequests["gpu"] != "4" {
		t.Errorf("expected prefill gpu request 4, got %v", prefillRequests["gpu"])
	}

	// Check decode has both limits and requests
	decode, _ := services["VllmDecodeWorker"].(map[string]interface{})
	decodeRes, _ := decode["resources"].(map[string]interface{})
	decodeLimits, _ := decodeRes["limits"].(map[string]interface{})
	decodeRequests, _ := decodeRes["requests"].(map[string]interface{})
	if decodeLimits["gpu"] != "2" {
		t.Errorf("expected decode gpu limit 2, got %v", decodeLimits["gpu"])
	}
	if decodeRequests["gpu"] != "2" {
		t.Errorf("expected decode gpu request 2, got %v", decodeRequests["gpu"])
	}
}

func TestTransformOverrideCanOverwriteServices(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Provider = &kubeairunwayv1alpha1.ProviderSpec{
		Name: "dynamo",
		Overrides: &runtime.RawExtension{
			Raw: []byte(`{
				"spec": {
					"services": {
						"VllmWorker": {
							"replicas": 3
						}
					}
				}
			}`),
		},
	}

	results, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	dgd := results[0]
	spec, _, _ := unstructured.NestedMap(dgd.Object, "spec")
	services, _ := spec["services"].(map[string]interface{})
	worker, _ := services["VllmWorker"].(map[string]interface{})

	// Deep merge should have replaced replicas but kept other fields
	if worker["replicas"] != float64(3) {
		t.Errorf("expected overridden replicas 3, got %v (type %T)", worker["replicas"], worker["replicas"])
	}
	// componentType should be preserved from the transformer
	if worker["componentType"] != ComponentTypeWorker {
		t.Errorf("expected componentType preserved, got %v", worker["componentType"])
	}
}

func TestTransformWithCustomImage(t *testing.T) {
	tr := NewTransformer()
	md := newTestMD("test-model", "default")
	md.Spec.Image = "my-registry.io/custom-vllm:v1"

	resources, err := tr.Transform(context.Background(), md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	dgd := resources[0]
	spec, _, _ := unstructured.NestedMap(dgd.Object, "spec")
	services, _ := spec["services"].(map[string]interface{})
	worker, _ := services["VllmWorker"].(map[string]interface{})
	eps, _ := worker["extraPodSpec"].(map[string]interface{})
	mc, _ := eps["mainContainer"].(map[string]interface{})
	if mc["image"] != "my-registry.io/custom-vllm:v1" {
		t.Errorf("expected custom image, got %v", mc["image"])
	}
}

func TestBuildResourceLimitsWithAllFields(t *testing.T) {
	tr := NewTransformer()
	result := tr.buildResourceLimits(&kubeairunwayv1alpha1.ResourceSpec{
		GPU:    &kubeairunwayv1alpha1.GPUSpec{Count: 2},
		Memory: "64Gi",
		CPU:    "16",
	})
	limits, _ := result["limits"].(map[string]interface{})
	requests, _ := result["requests"].(map[string]interface{})

	if limits["gpu"] != "2" {
		t.Errorf("expected gpu limit 2, got %v", limits["gpu"])
	}
	if limits["memory"] != "64Gi" {
		t.Errorf("expected memory limit 64Gi, got %v", limits["memory"])
	}
	if limits["cpu"] != "16" {
		t.Errorf("expected cpu limit 16, got %v", limits["cpu"])
	}
	if requests["gpu"] != "2" {
		t.Errorf("expected gpu request 2, got %v", requests["gpu"])
	}
	// Memory and CPU should not be in requests (only gpu goes there)
	if _, ok := requests["memory"]; ok {
		t.Error("did not expect memory in requests")
	}
}
