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

package controller

import (
	"context"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	fakediscovery "k8s.io/client-go/discovery/fake"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	k8stesting "k8s.io/client-go/testing"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	kubeairunwayv1alpha1 "github.com/kaito-project/kubeairunway/controller/api/v1alpha1"
	"github.com/kaito-project/kubeairunway/controller/internal/gateway"
	inferencev1 "sigs.k8s.io/gateway-api-inference-extension/api/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func newTestScheme() *runtime.Scheme {
	s := runtime.NewScheme()
	utilruntime.Must(clientgoscheme.AddToScheme(s))
	utilruntime.Must(kubeairunwayv1alpha1.AddToScheme(s))
	utilruntime.Must(gatewayv1.Install(s))
	utilruntime.Must(inferencev1.Install(s))
	return s
}

func boolPtr(b bool) *bool { return &b }

// newTestReconciler creates a ModelDeploymentReconciler with a fake client and
// an optional gateway detector.
func newTestReconciler(scheme *runtime.Scheme, detector *gateway.Detector, objs ...client.Object) *ModelDeploymentReconciler {
	cb := fake.NewClientBuilder().WithScheme(scheme).WithStatusSubresource(&kubeairunwayv1alpha1.ModelDeployment{})
	if len(objs) > 0 {
		cb = cb.WithObjects(objs...)
	}
	return &ModelDeploymentReconciler{
		Client:          cb.Build(),
		Scheme:          scheme,
		GatewayDetector: detector,
	}
}

func newModelDeployment(name, ns string) *kubeairunwayv1alpha1.ModelDeployment {
	return &kubeairunwayv1alpha1.ModelDeployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: ns,
		},
		Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
			Model: kubeairunwayv1alpha1.ModelSpec{
				ID:     "meta-llama/Llama-3-8B",
				Source: kubeairunwayv1alpha1.ModelSourceHuggingFace,
			},
		},
		Status: kubeairunwayv1alpha1.ModelDeploymentStatus{
			Phase: kubeairunwayv1alpha1.DeploymentPhaseRunning,
			Endpoint: &kubeairunwayv1alpha1.EndpointStatus{
				Service: "test-model-svc",
				Port:    8080,
			},
		},
	}
}

// fakeDetector returns a Detector with explicit gateway config and availability set.
func fakeDetector(available bool, gwName, gwNs string) *gateway.Detector {
	dc := &fakediscovery.FakeDiscovery{Fake: &k8stesting.Fake{}}
	if available {
		dc.Resources = []*metav1.APIResourceList{
			{
				GroupVersion: "inference.networking.k8s.io/v1",
				APIResources: []metav1.APIResource{{Name: "inferencepools"}},
			},
			{
				GroupVersion: "gateway.networking.k8s.io/v1",
				APIResources: []metav1.APIResource{{Name: "httproutes"}, {Name: "gateways"}},
			},
		}
	}
	d := gateway.NewDetector(dc)
	d.ExplicitGatewayName = gwName
	d.ExplicitGatewayNamespace = gwNs
	// Warm the cache
	d.IsAvailable(context.Background())
	return d
}

// --- Tests ---

func TestGateway_InferencePoolCreation(t *testing.T) {
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	detector := fakeDetector(true, "my-gateway", "gateway-ns")
	r := newTestReconciler(scheme, detector, md)
	ctx := context.Background()

	err := r.reconcileInferencePool(ctx, md, 8080)
	if err != nil {
		t.Fatalf("reconcileInferencePool failed: %v", err)
	}

	// Verify InferencePool was created
	var pool inferencev1.InferencePool
	if err := r.Get(ctx, types.NamespacedName{Name: "test-model", Namespace: "default"}, &pool); err != nil {
		t.Fatalf("InferencePool not found: %v", err)
	}

	// Check selector labels
	expectedLabel := inferencev1.LabelKey(kubeairunwayv1alpha1.LabelModelDeployment)
	val, ok := pool.Spec.Selector.MatchLabels[expectedLabel]
	if !ok {
		t.Errorf("expected selector label %s not found", expectedLabel)
	}
	if string(val) != "test-model" {
		t.Errorf("expected selector label value %q, got %q", "test-model", val)
	}

	// Check target port
	if len(pool.Spec.TargetPorts) != 1 {
		t.Fatalf("expected 1 target port, got %d", len(pool.Spec.TargetPorts))
	}
	if pool.Spec.TargetPorts[0].Number != 8080 {
		t.Errorf("expected target port 8080, got %d", pool.Spec.TargetPorts[0].Number)
	}

	// Check EndpointPickerRef
	if string(pool.Spec.EndpointPickerRef.Name) != "kubeairunway-epp" {
		t.Errorf("expected EndpointPickerRef name %q, got %q", "kubeairunway-epp", pool.Spec.EndpointPickerRef.Name)
	}
	if pool.Spec.EndpointPickerRef.Port == nil || pool.Spec.EndpointPickerRef.Port.Number != 9002 {
		t.Errorf("expected EndpointPickerRef port 9002, got %v", pool.Spec.EndpointPickerRef.Port)
	}

	// Check OwnerReference
	if len(pool.OwnerReferences) != 1 {
		t.Fatalf("expected 1 owner reference, got %d", len(pool.OwnerReferences))
	}
	if pool.OwnerReferences[0].Name != "test-model" {
		t.Errorf("expected owner ref name %q, got %q", "test-model", pool.OwnerReferences[0].Name)
	}
	if pool.OwnerReferences[0].Kind != "ModelDeployment" {
		t.Errorf("expected owner ref kind %q, got %q", "ModelDeployment", pool.OwnerReferences[0].Kind)
	}
}

func TestGateway_InferencePoolDefaultPort(t *testing.T) {
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	md.Status.Endpoint = nil // no endpoint, should use default port
	detector := fakeDetector(true, "my-gateway", "gateway-ns")
	r := newTestReconciler(scheme, detector, md)
	ctx := context.Background()

	// reconcileGateway uses default port 8000 when no endpoint
	err := r.reconcileInferencePool(ctx, md, 8000)
	if err != nil {
		t.Fatalf("reconcileInferencePool failed: %v", err)
	}

	var pool inferencev1.InferencePool
	if err := r.Get(ctx, types.NamespacedName{Name: "test-model", Namespace: "default"}, &pool); err != nil {
		t.Fatalf("InferencePool not found: %v", err)
	}
	if pool.Spec.TargetPorts[0].Number != 8000 {
		t.Errorf("expected default target port 8000, got %d", pool.Spec.TargetPorts[0].Number)
	}
}

func TestGateway_HTTPRouteCreation(t *testing.T) {
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	detector := fakeDetector(true, "my-gateway", "gateway-ns")
	r := newTestReconciler(scheme, detector, md)
	ctx := context.Background()

	gwConfig := &gateway.GatewayConfig{
		GatewayName:      "my-gateway",
		GatewayNamespace: "gateway-ns",
	}

	err := r.reconcileHTTPRoute(ctx, md, gwConfig)
	if err != nil {
		t.Fatalf("reconcileHTTPRoute failed: %v", err)
	}

	// Verify HTTPRoute was created
	var route gatewayv1.HTTPRoute
	if err := r.Get(ctx, types.NamespacedName{Name: "test-model", Namespace: "default"}, &route); err != nil {
		t.Fatalf("HTTPRoute not found: %v", err)
	}

	// Check parent ref points to the gateway
	if len(route.Spec.ParentRefs) != 1 {
		t.Fatalf("expected 1 parent ref, got %d", len(route.Spec.ParentRefs))
	}
	parentRef := route.Spec.ParentRefs[0]
	if string(parentRef.Name) != "my-gateway" {
		t.Errorf("expected parent ref name %q, got %q", "my-gateway", parentRef.Name)
	}
	if parentRef.Namespace == nil || string(*parentRef.Namespace) != "gateway-ns" {
		t.Errorf("expected parent ref namespace %q, got %v", "gateway-ns", parentRef.Namespace)
	}

	// Check backend ref points to InferencePool
	if len(route.Spec.Rules) != 1 {
		t.Fatalf("expected 1 rule, got %d", len(route.Spec.Rules))
	}
	if len(route.Spec.Rules[0].BackendRefs) != 1 {
		t.Fatalf("expected 1 backend ref, got %d", len(route.Spec.Rules[0].BackendRefs))
	}
	backendRef := route.Spec.Rules[0].BackendRefs[0]
	if string(backendRef.Name) != "test-model" {
		t.Errorf("expected backend ref name %q, got %q", "test-model", backendRef.Name)
	}
	if backendRef.Group == nil || string(*backendRef.Group) != "inference.networking.k8s.io" {
		t.Errorf("expected backend ref group %q, got %v", "inference.networking.k8s.io", backendRef.Group)
	}
	if backendRef.Kind == nil || string(*backendRef.Kind) != "InferencePool" {
		t.Errorf("expected backend ref kind %q, got %v", "InferencePool", backendRef.Kind)
	}

	// Check OwnerReference
	if len(route.OwnerReferences) != 1 {
		t.Fatalf("expected 1 owner reference, got %d", len(route.OwnerReferences))
	}
	if route.OwnerReferences[0].Name != "test-model" {
		t.Errorf("expected owner ref name %q, got %q", "test-model", route.OwnerReferences[0].Name)
	}
}

func TestGateway_DisabledSkipsCreation(t *testing.T) {
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	md.Spec.Gateway = &kubeairunwayv1alpha1.GatewaySpec{
		Enabled: boolPtr(false),
	}
	detector := fakeDetector(true, "my-gateway", "gateway-ns")
	r := newTestReconciler(scheme, detector, md)
	ctx := context.Background()

	err := r.reconcileGateway(ctx, md)
	if err != nil {
		t.Fatalf("reconcileGateway failed: %v", err)
	}

	// Verify no InferencePool was created
	var pool inferencev1.InferencePool
	err = r.Get(ctx, types.NamespacedName{Name: "test-model", Namespace: "default"}, &pool)
	if err == nil {
		t.Error("expected InferencePool to NOT be created when gateway is disabled")
	}

	// Verify no HTTPRoute was created
	var route gatewayv1.HTTPRoute
	err = r.Get(ctx, types.NamespacedName{Name: "test-model", Namespace: "default"}, &route)
	if err == nil {
		t.Error("expected HTTPRoute to NOT be created when gateway is disabled")
	}
}

func TestGateway_DisabledCleansUpExistingResources(t *testing.T) {
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	detector := fakeDetector(true, "my-gateway", "gateway-ns")

	// Pre-create gateway resources
	pool := &inferencev1.InferencePool{
		ObjectMeta: metav1.ObjectMeta{Name: "test-model", Namespace: "default"},
	}
	route := &gatewayv1.HTTPRoute{
		ObjectMeta: metav1.ObjectMeta{Name: "test-model", Namespace: "default"},
	}
	r := newTestReconciler(scheme, detector, md, pool, route)
	ctx := context.Background()

	err := r.cleanupGatewayResources(ctx, md)
	if err != nil {
		t.Fatalf("cleanupGatewayResources failed: %v", err)
	}

	// Verify InferencePool was deleted
	var p inferencev1.InferencePool
	if err := r.Get(ctx, types.NamespacedName{Name: "test-model", Namespace: "default"}, &p); err == nil {
		t.Error("expected InferencePool to be deleted")
	}

	// Verify HTTPRoute was deleted
	var rt gatewayv1.HTTPRoute
	if err := r.Get(ctx, types.NamespacedName{Name: "test-model", Namespace: "default"}, &rt); err == nil {
		t.Error("expected HTTPRoute to be deleted")
	}

	// Verify gateway status is cleared
	if md.Status.Gateway != nil {
		t.Error("expected gateway status to be nil after cleanup")
	}

	// Verify GatewayReady condition is set to False
	found := false
	for _, c := range md.Status.Conditions {
		if c.Type == kubeairunwayv1alpha1.ConditionTypeGatewayReady {
			found = true
			if c.Status != metav1.ConditionFalse {
				t.Errorf("expected GatewayReady condition to be False after cleanup, got %s", c.Status)
			}
			if c.Reason != "GatewayDisabled" {
				t.Errorf("expected reason GatewayDisabled, got %s", c.Reason)
			}
		}
	}
	if !found {
		t.Error("expected GatewayReady condition to be set after cleanup")
	}
}

func TestGateway_CleanupOnPhaseTransition(t *testing.T) {
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	// Simulate a deployment that was Running with gateway resources
	md.Status.Phase = kubeairunwayv1alpha1.DeploymentPhaseFailed
	md.Status.Gateway = &kubeairunwayv1alpha1.GatewayStatus{
		Endpoint:  "10.0.0.1",
		ModelName: "some-model",
		Ready:     true,
	}
	detector := fakeDetector(true, "my-gateway", "gateway-ns")

	// Pre-create gateway resources
	pool := &inferencev1.InferencePool{
		ObjectMeta: metav1.ObjectMeta{Name: "test-model", Namespace: "default"},
	}
	route := &gatewayv1.HTTPRoute{
		ObjectMeta: metav1.ObjectMeta{Name: "test-model", Namespace: "default"},
	}
	r := newTestReconciler(scheme, detector, md, pool, route)
	ctx := context.Background()

	// cleanupGatewayResources should clean up since phase != Running but gateway exists
	err := r.cleanupGatewayResources(ctx, md)
	if err != nil {
		t.Fatalf("cleanupGatewayResources failed: %v", err)
	}

	// Verify resources deleted
	var p inferencev1.InferencePool
	if err := r.Get(ctx, types.NamespacedName{Name: "test-model", Namespace: "default"}, &p); err == nil {
		t.Error("expected InferencePool to be deleted on phase transition")
	}
	var rt gatewayv1.HTTPRoute
	if err := r.Get(ctx, types.NamespacedName{Name: "test-model", Namespace: "default"}, &rt); err == nil {
		t.Error("expected HTTPRoute to be deleted on phase transition")
	}

	// Verify status cleared and condition set
	if md.Status.Gateway != nil {
		t.Error("expected gateway status to be nil after phase transition cleanup")
	}
	for _, c := range md.Status.Conditions {
		if c.Type == kubeairunwayv1alpha1.ConditionTypeGatewayReady {
			if c.Status != metav1.ConditionFalse {
				t.Errorf("expected GatewayReady False after phase transition, got %s", c.Status)
			}
			return
		}
	}
	t.Error("expected GatewayReady condition to be set after phase transition")
}

func TestGateway_NotAvailableSkipsSilently(t *testing.T) {
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	// Detector says CRDs not available
	detector := fakeDetector(false, "", "")
	r := newTestReconciler(scheme, detector, md)
	ctx := context.Background()

	err := r.reconcileGateway(ctx, md)
	if err != nil {
		t.Fatalf("expected no error when gateway not available, got: %v", err)
	}

	// Verify no InferencePool was created
	var pool inferencev1.InferencePool
	err = r.Get(ctx, types.NamespacedName{Name: "test-model", Namespace: "default"}, &pool)
	if err == nil {
		t.Error("expected InferencePool to NOT be created when gateway not available")
	}
}

func TestGateway_NilDetectorSkipsSilently(t *testing.T) {
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	// No detector at all
	r := newTestReconciler(scheme, nil, md)
	ctx := context.Background()

	err := r.reconcileGateway(ctx, md)
	if err != nil {
		t.Fatalf("expected no error when detector is nil, got: %v", err)
	}
}

func TestGateway_StatusUpdate(t *testing.T) {
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	detector := fakeDetector(true, "my-gateway", "gateway-ns")
	r := newTestReconciler(scheme, detector, md)
	ctx := context.Background()

	err := r.reconcileGateway(ctx, md)
	if err != nil {
		t.Fatalf("reconcileGateway failed: %v", err)
	}

	// Check gateway status
	if md.Status.Gateway == nil {
		t.Fatal("expected gateway status to be set")
	}
	if !md.Status.Gateway.Ready {
		t.Error("expected gateway status to be ready")
	}
	if md.Status.Gateway.Endpoint != "" {
		t.Errorf("expected empty endpoint when Gateway has no status address, got %q", md.Status.Gateway.Endpoint)
	}
	if md.Status.Gateway.ModelName != "meta-llama/Llama-3-8B" {
		t.Errorf("expected model name %q, got %q", "meta-llama/Llama-3-8B", md.Status.Gateway.ModelName)
	}

	// Check GatewayReady condition
	found := false
	for _, c := range md.Status.Conditions {
		if c.Type == kubeairunwayv1alpha1.ConditionTypeGatewayReady {
			found = true
			if c.Status != metav1.ConditionTrue {
				t.Errorf("expected GatewayReady condition to be True, got %s", c.Status)
			}
		}
	}
	if !found {
		t.Error("expected GatewayReady condition to be set")
	}
}

func TestGateway_StatusEndpointFromGatewayAddress(t *testing.T) {
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	gw := &gatewayv1.Gateway{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-gateway",
			Namespace: "gateway-ns",
		},
		Spec: gatewayv1.GatewaySpec{
			GatewayClassName: "istio",
		},
		Status: gatewayv1.GatewayStatus{
			Addresses: []gatewayv1.GatewayStatusAddress{
				{Value: "10.0.0.42"},
			},
		},
	}
	detector := fakeDetector(true, "my-gateway", "gateway-ns")
	r := newTestReconciler(scheme, detector, md, gw)
	ctx := context.Background()

	err := r.reconcileGateway(ctx, md)
	if err != nil {
		t.Fatalf("reconcileGateway failed: %v", err)
	}

	if md.Status.Gateway == nil {
		t.Fatal("expected gateway status to be set")
	}
	if md.Status.Gateway.Endpoint != "10.0.0.42" {
		t.Errorf("expected endpoint %q, got %q", "10.0.0.42", md.Status.Gateway.Endpoint)
	}
}

func TestGateway_StatusModelNameOverride(t *testing.T) {
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	md.Spec.Gateway = &kubeairunwayv1alpha1.GatewaySpec{
		ModelName: "custom-model-name",
	}
	detector := fakeDetector(true, "my-gateway", "gateway-ns")
	r := newTestReconciler(scheme, detector, md)
	ctx := context.Background()

	err := r.reconcileGateway(ctx, md)
	if err != nil {
		t.Fatalf("reconcileGateway failed: %v", err)
	}

	if md.Status.Gateway.ModelName != "custom-model-name" {
		t.Errorf("expected model name %q, got %q", "custom-model-name", md.Status.Gateway.ModelName)
	}
}

func TestGateway_StatusServedNameFallback(t *testing.T) {
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	md.Spec.Model.ServedName = "llama-3"
	detector := fakeDetector(true, "my-gateway", "gateway-ns")
	r := newTestReconciler(scheme, detector, md)
	ctx := context.Background()

	err := r.reconcileGateway(ctx, md)
	if err != nil {
		t.Fatalf("reconcileGateway failed: %v", err)
	}

	if md.Status.Gateway.ModelName != "llama-3" {
		t.Errorf("expected model name %q, got %q", "llama-3", md.Status.Gateway.ModelName)
	}
}

func TestGateway_ModelNameAutoDiscoveryFallsBackToModelID(t *testing.T) {
	// When no server is reachable, resolveModelName should fall back to spec.model.id
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	md.Status.Endpoint = &kubeairunwayv1alpha1.EndpointStatus{
		Service: "nonexistent-svc",
		Port:    8080,
	}
	detector := fakeDetector(true, "my-gateway", "gateway-ns")
	r := newTestReconciler(scheme, detector, md)
	ctx := context.Background()

	name := r.resolveModelName(ctx, md)
	if name != "meta-llama/Llama-3-8B" {
		t.Errorf("expected fallback to spec.model.id %q, got %q", "meta-llama/Llama-3-8B", name)
	}
}

func TestGateway_ModelNameExplicitOverrideTakesPriority(t *testing.T) {
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	md.Spec.Gateway = &kubeairunwayv1alpha1.GatewaySpec{
		ModelName: "my-override",
	}
	md.Spec.Model.ServedName = "should-not-use"
	md.Status.Endpoint = &kubeairunwayv1alpha1.EndpointStatus{
		Service: "some-svc",
		Port:    8080,
	}
	detector := fakeDetector(true, "my-gateway", "gateway-ns")
	r := newTestReconciler(scheme, detector, md)
	ctx := context.Background()

	name := r.resolveModelName(ctx, md)
	if name != "my-override" {
		t.Errorf("expected explicit override %q, got %q", "my-override", name)
	}
}

func TestGateway_ModelNameServedNameSkipsDiscovery(t *testing.T) {
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	md.Spec.Model.ServedName = "explicit-served"
	md.Status.Endpoint = &kubeairunwayv1alpha1.EndpointStatus{
		Service: "some-svc",
		Port:    8080,
	}
	detector := fakeDetector(true, "my-gateway", "gateway-ns")
	r := newTestReconciler(scheme, detector, md)
	ctx := context.Background()

	name := r.resolveModelName(ctx, md)
	if name != "explicit-served" {
		t.Errorf("expected served name %q, got %q", "explicit-served", name)
	}
}

func TestGateway_ModelNameNoEndpointFallsBack(t *testing.T) {
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	md.Status.Endpoint = nil // no endpoint info
	detector := fakeDetector(true, "my-gateway", "gateway-ns")
	r := newTestReconciler(scheme, detector, md)
	ctx := context.Background()

	name := r.resolveModelName(ctx, md)
	if name != "meta-llama/Llama-3-8B" {
		t.Errorf("expected fallback to spec.model.id %q, got %q", "meta-llama/Llama-3-8B", name)
	}
}

func TestGateway_CleanupNonExistentResourcesNoError(t *testing.T) {
	scheme := newTestScheme()
	md := newModelDeployment("test-model", "default")
	md.Status.Gateway = &kubeairunwayv1alpha1.GatewayStatus{Ready: true}
	r := newTestReconciler(scheme, nil, md)
	ctx := context.Background()

	// Should not error even if resources don't exist
	err := r.cleanupGatewayResources(ctx, md)
	if err != nil {
		t.Fatalf("cleanupGatewayResources failed on non-existent resources: %v", err)
	}
	if md.Status.Gateway != nil {
		t.Error("expected gateway status to be cleared")
	}
}
