package kaito

import (
	"context"
	"testing"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestGetProviderConfigSpec(t *testing.T) {
	spec := GetProviderConfigSpec()

	if spec.Capabilities == nil {
		t.Fatal("capabilities should not be nil")
	}

	expectedEngines := []airunwayv1alpha1.EngineType{
		airunwayv1alpha1.EngineTypeVLLM,
		airunwayv1alpha1.EngineTypeLlamaCpp,
	}
	if len(spec.Capabilities.Engines) != len(expectedEngines) {
		t.Fatalf("expected %d engines, got %d", len(expectedEngines), len(spec.Capabilities.Engines))
	}
	for i, e := range expectedEngines {
		if spec.Capabilities.Engines[i].Name != e {
			t.Errorf("engine[%d]: expected %s, got %s", i, e, spec.Capabilities.Engines[i].Name)
		}
	}

	// Verify per-engine capabilities
	vllmCap := spec.Capabilities.GetEngineCapability(airunwayv1alpha1.EngineTypeVLLM)
	if vllmCap == nil {
		t.Fatal("expected vllm engine capability")
	}
	if !vllmCap.GPUSupport {
		t.Error("expected vllm GPU support to be true")
	}
	if vllmCap.CPUSupport {
		t.Error("expected vllm CPU support to be false")
	}
	if len(vllmCap.ServingModes) != 1 || vllmCap.ServingModes[0] != airunwayv1alpha1.ServingModeAggregated {
		t.Errorf("expected vllm to support only aggregated serving mode")
	}

	llamaCap := spec.Capabilities.GetEngineCapability(airunwayv1alpha1.EngineTypeLlamaCpp)
	if llamaCap == nil {
		t.Fatal("expected llamacpp engine capability")
	}
	if !llamaCap.GPUSupport {
		t.Error("expected llamacpp GPU support to be true")
	}
	if !llamaCap.CPUSupport {
		t.Error("expected llamacpp CPU support to be true")
	}
	if len(llamaCap.ServingModes) != 1 || llamaCap.ServingModes[0] != airunwayv1alpha1.ServingModeAggregated {
		t.Errorf("expected llamacpp to support only aggregated serving mode")
	}

	if len(spec.SelectionRules) != 2 {
		t.Fatalf("expected 2 selection rules, got %d", len(spec.SelectionRules))
	}
	if spec.SelectionRules[0].Priority != 100 {
		t.Errorf("expected first rule priority 100, got %d", spec.SelectionRules[0].Priority)
	}
}

func TestGetInstallationInfo(t *testing.T) {
	info := GetInstallationInfo()
	if info == nil {
		t.Fatal("expected non-nil installation info")
	}
	if info.Description == "" {
		t.Error("expected non-empty description")
	}
	if info.DefaultNamespace != "kaito-workspace" {
		t.Errorf("expected defaultNamespace 'kaito-workspace', got %s", info.DefaultNamespace)
	}
	if len(info.HelmRepos) != 1 {
		t.Fatalf("expected 1 helm repo, got %d", len(info.HelmRepos))
	}
	if len(info.HelmCharts) != 1 {
		t.Fatalf("expected 1 helm chart, got %d", len(info.HelmCharts))
	}
	if len(info.Steps) != 3 {
		t.Fatalf("expected 3 installation steps, got %d", len(info.Steps))
	}
}

func TestNewProviderConfigManager(t *testing.T) {
	mgr := NewProviderConfigManager(nil)
	if mgr == nil {
		t.Fatal("expected non-nil manager")
	}
}

func TestProviderConstants(t *testing.T) {
	if ProviderConfigName != "kaito" {
		t.Errorf("expected provider config name 'kaito', got %s", ProviderConfigName)
	}
	if ProviderVersion != "kaito-provider:v0.1.0" {
		t.Errorf("expected provider version 'kaito-provider:v0.1.0', got %s", ProviderVersion)
	}
}

func TestRegisterNew(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = airunwayv1alpha1.AddToScheme(scheme)

	c := fake.NewClientBuilder().WithScheme(scheme).WithStatusSubresource(&airunwayv1alpha1.InferenceProviderConfig{}).Build()
	mgr := NewProviderConfigManager(c)

	err := mgr.Register(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRegisterExisting(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = airunwayv1alpha1.AddToScheme(scheme)

	existing := &airunwayv1alpha1.InferenceProviderConfig{
		ObjectMeta: metav1.ObjectMeta{Name: ProviderConfigName},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existing).WithStatusSubresource(existing).Build()
	mgr := NewProviderConfigManager(c)

	err := mgr.Register(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestUpdateStatus(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = airunwayv1alpha1.AddToScheme(scheme)

	existing := &airunwayv1alpha1.InferenceProviderConfig{
		ObjectMeta: metav1.ObjectMeta{Name: ProviderConfigName},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existing).WithStatusSubresource(existing).Build()
	mgr := NewProviderConfigManager(c)

	err := mgr.UpdateStatus(context.Background(), true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestUnregister(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = airunwayv1alpha1.AddToScheme(scheme)

	existing := &airunwayv1alpha1.InferenceProviderConfig{
		ObjectMeta: metav1.ObjectMeta{Name: ProviderConfigName},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existing).WithStatusSubresource(existing).Build()
	mgr := NewProviderConfigManager(c)

	err := mgr.Unregister(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestStartHeartbeat(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = airunwayv1alpha1.AddToScheme(scheme)

	existing := &airunwayv1alpha1.InferenceProviderConfig{
		ObjectMeta: metav1.ObjectMeta{Name: ProviderConfigName},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existing).WithStatusSubresource(existing).Build()
	mgr := NewProviderConfigManager(c)

	ctx, cancel := context.WithCancel(context.Background())
	mgr.StartHeartbeat(ctx)
	// Cancel immediately to stop the goroutine
	cancel()
}

func TestUpdateStatusNotFound(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = airunwayv1alpha1.AddToScheme(scheme)

	c := fake.NewClientBuilder().WithScheme(scheme).Build()
	mgr := NewProviderConfigManager(c)

	err := mgr.UpdateStatus(context.Background(), true)
	if err == nil {
		t.Fatal("expected error when config not found")
	}
}
