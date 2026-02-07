package kaito

import (
	"context"
	"testing"

	kubefoundryv1alpha1 "github.com/kubefoundry/kubefoundry/controller/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestGetProviderConfigSpec(t *testing.T) {
	spec := GetProviderConfigSpec()

	if spec.Capabilities == nil {
		t.Fatal("capabilities should not be nil")
	}

	expectedEngines := []kubefoundryv1alpha1.EngineType{
		kubefoundryv1alpha1.EngineTypeVLLM,
		kubefoundryv1alpha1.EngineTypeLlamaCpp,
	}
	if len(spec.Capabilities.Engines) != len(expectedEngines) {
		t.Fatalf("expected %d engines, got %d", len(expectedEngines), len(spec.Capabilities.Engines))
	}
	for i, e := range expectedEngines {
		if spec.Capabilities.Engines[i] != e {
			t.Errorf("engine[%d]: expected %s, got %s", i, e, spec.Capabilities.Engines[i])
		}
	}

	if len(spec.Capabilities.ServingModes) != 1 || spec.Capabilities.ServingModes[0] != kubefoundryv1alpha1.ServingModeAggregated {
		t.Errorf("expected only aggregated serving mode")
	}

	if !spec.Capabilities.CPUSupport {
		t.Error("expected CPU support to be true")
	}
	if !spec.Capabilities.GPUSupport {
		t.Error("expected GPU support to be true")
	}

	if len(spec.SelectionRules) != 2 {
		t.Fatalf("expected 2 selection rules, got %d", len(spec.SelectionRules))
	}
	if spec.SelectionRules[0].Priority != 100 {
		t.Errorf("expected first rule priority 100, got %d", spec.SelectionRules[0].Priority)
	}

	if spec.Documentation != ProviderDocumentation {
		t.Errorf("expected documentation %s, got %s", ProviderDocumentation, spec.Documentation)
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
	_ = kubefoundryv1alpha1.AddToScheme(scheme)

	c := fake.NewClientBuilder().WithScheme(scheme).WithStatusSubresource(&kubefoundryv1alpha1.InferenceProviderConfig{}).Build()
	mgr := NewProviderConfigManager(c)

	err := mgr.Register(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRegisterExisting(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = kubefoundryv1alpha1.AddToScheme(scheme)

	existing := &kubefoundryv1alpha1.InferenceProviderConfig{
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
	_ = kubefoundryv1alpha1.AddToScheme(scheme)

	existing := &kubefoundryv1alpha1.InferenceProviderConfig{
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
	_ = kubefoundryv1alpha1.AddToScheme(scheme)

	existing := &kubefoundryv1alpha1.InferenceProviderConfig{
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
	_ = kubefoundryv1alpha1.AddToScheme(scheme)

	existing := &kubefoundryv1alpha1.InferenceProviderConfig{
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
	_ = kubefoundryv1alpha1.AddToScheme(scheme)

	c := fake.NewClientBuilder().WithScheme(scheme).Build()
	mgr := NewProviderConfigManager(c)

	err := mgr.UpdateStatus(context.Background(), true)
	if err == nil {
		t.Fatal("expected error when config not found")
	}
}
