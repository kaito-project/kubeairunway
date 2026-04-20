package dynamo

import (
	"context"
	"testing"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	fakediscovery "k8s.io/client-go/discovery/fake"
	k8stesting "k8s.io/client-go/testing"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestGetProviderConfigSpec(t *testing.T) {
	spec := GetProviderConfigSpec()

	if spec.Capabilities == nil {
		t.Fatal("capabilities should not be nil")
	}

	expectedEngines := []airunwayv1alpha1.EngineType{
		airunwayv1alpha1.EngineTypeVLLM,
		airunwayv1alpha1.EngineTypeSGLang,
		airunwayv1alpha1.EngineTypeTRTLLM,
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

	if spec.Installation == nil {
		t.Fatal("installation should not be nil")
	}
	if len(spec.Installation.HelmCharts) != 1 {
		t.Fatalf("expected 1 helm chart, got %d", len(spec.Installation.HelmCharts))
	}
	if spec.Installation.HelmCharts[0].Chart != DynamoPlatformChartURL {
		t.Errorf("expected platform chart URL %q, got %q", DynamoPlatformChartURL, spec.Installation.HelmCharts[0].Chart)
	}
	groveInstall, ok := spec.Installation.HelmCharts[0].Values["global.grove.install"]
	if !ok {
		t.Fatal("expected dynamo platform chart to enable Grove by default")
	}
	if string(groveInstall.Raw) != "true" {
		t.Fatalf("expected global.grove.install=true, got %s", string(groveInstall.Raw))
	}
	if len(spec.Installation.Steps) != 1 {
		t.Fatalf("expected 1 installation step, got %d", len(spec.Installation.Steps))
	}
	if spec.Installation.Steps[0].Command != "helm upgrade --install dynamo-platform "+DynamoPlatformChartURL+" --namespace dynamo-system --create-namespace --set-json global.grove.install=true" {
		t.Fatalf("unexpected installation command: %s", spec.Installation.Steps[0].Command)
	}

	if spec.Documentation != ProviderDocumentation {
		t.Errorf("expected documentation %s, got %s", ProviderDocumentation, spec.Documentation)
	}

	if spec.Capabilities.Gateway.InferencePoolNamePattern != "{name}-pool" {
		t.Errorf("expected inference pool name pattern to be '{name}-pool', got %s", spec.Capabilities.Gateway.InferencePoolNamePattern)
	}

	if spec.Capabilities.Gateway.InferencePoolNamespace != "{namespace}" {
		t.Errorf("expected inference pool namespace to be '{namespace}', got %s", spec.Capabilities.Gateway.InferencePoolNamespace)
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
	if ProviderVersion != "dynamo-provider:v0.2.0" {
		t.Errorf("expected provider version 'dynamo-provider:v0.2.0', got %s", ProviderVersion)
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

func TestCheckBackendCRDInstalledUsesDiscoveryFreshResults(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = airunwayv1alpha1.AddToScheme(scheme)

	discoveryClient := &fakediscovery.FakeDiscovery{
		Fake: &k8stesting.Fake{},
	}
	discoveryClient.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: DynamoAPIGroup + "/" + DynamoAPIVersion,
			APIResources: []metav1.APIResource{
				{Name: dynamoGraphDeploymentResource},
			},
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).Build()
	mgr := NewProviderConfigManager(c, discoveryClient)

	if !mgr.checkBackendCRDInstalled() {
		t.Fatal("expected backend CRD to be detected")
	}

	discoveryClient.Resources = []*metav1.APIResourceList{}

	if mgr.checkBackendCRDInstalled() {
		t.Fatal("expected backend CRD removal to be detected on the next check")
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

	updated := &airunwayv1alpha1.InferenceProviderConfig{}
	if err := c.Get(context.Background(), client.ObjectKey{Name: ProviderConfigName}, updated); err != nil {
		t.Fatalf("failed to get updated provider config: %v", err)
	}

	if !updated.Status.Ready {
		t.Fatal("expected provider status to be ready")
	}
	if updated.Status.Version != ProviderVersion {
		t.Fatalf("expected provider status version %q, got %q", ProviderVersion, updated.Status.Version)
	}
	if updated.Status.LastHeartbeat == nil {
		t.Fatal("expected provider status to include last heartbeat")
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
