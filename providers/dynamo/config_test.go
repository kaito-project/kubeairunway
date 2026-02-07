package dynamo

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
		kubefoundryv1alpha1.EngineTypeSGLang,
		kubefoundryv1alpha1.EngineTypeTRTLLM,
	}
	if len(spec.Capabilities.Engines) != len(expectedEngines) {
		t.Fatalf("expected %d engines, got %d", len(expectedEngines), len(spec.Capabilities.Engines))
	}

	if len(spec.Capabilities.ServingModes) != 2 {
		t.Fatalf("expected 2 serving modes, got %d", len(spec.Capabilities.ServingModes))
	}

	if spec.Capabilities.CPUSupport {
		t.Error("expected CPU support to be false")
	}
	if !spec.Capabilities.GPUSupport {
		t.Error("expected GPU support to be true")
	}

	if len(spec.SelectionRules) != 4 {
		t.Fatalf("expected 4 selection rules, got %d", len(spec.SelectionRules))
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
	if ProviderConfigName != "dynamo" {
		t.Errorf("expected provider config name 'dynamo', got %s", ProviderConfigName)
	}
	if ProviderVersion != "dynamo-provider:v0.1.0" {
		t.Errorf("expected provider version 'dynamo-provider:v0.1.0', got %s", ProviderVersion)
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
