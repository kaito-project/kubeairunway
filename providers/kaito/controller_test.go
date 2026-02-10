package kaito

import (
	"context"
	"testing"
	"time"

	kubeairunwayv1alpha1 "github.com/kaito-project/kubeairunway/controller/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
)

func newScheme() *runtime.Scheme {
	s := runtime.NewScheme()
	_ = kubeairunwayv1alpha1.AddToScheme(s)
	return s
}

func newMDForController(name, ns string) *kubeairunwayv1alpha1.ModelDeployment {
	return &kubeairunwayv1alpha1.ModelDeployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: ns,
		},
		Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
			Model:  kubeairunwayv1alpha1.ModelSpec{ID: "test-model", Source: kubeairunwayv1alpha1.ModelSourceHuggingFace},
			Engine: kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeVLLM},
		},
		Status: kubeairunwayv1alpha1.ModelDeploymentStatus{
			Provider: &kubeairunwayv1alpha1.ProviderStatus{Name: ProviderName},
		},
	}
}

func TestValidateCompatibility(t *testing.T) {
	r := &KaitoProviderReconciler{}

	tests := []struct {
		name    string
		md      *kubeairunwayv1alpha1.ModelDeployment
		wantErr bool
		errMsg  string
	}{
		{
			name: "vllm is compatible",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Engine: kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeVLLM},
				},
			},
			wantErr: false,
		},
		{
			name: "llamacpp with image is compatible",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Engine: kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeLlamaCpp},
					Image:  "my-image:latest",
				},
			},
			wantErr: false,
		},
		{
			name: "llamacpp without image is incompatible",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Engine: kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeLlamaCpp},
				},
			},
			wantErr: true,
			errMsg:  "llamacpp engine requires spec.image to be set",
		},
		{
			name: "sglang is incompatible",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Engine: kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeSGLang},
				},
			},
			wantErr: true,
			errMsg:  "KAITO does not support sglang engine",
		},
		{
			name: "trtllm is incompatible",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Engine: kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeTRTLLM},
				},
			},
			wantErr: true,
			errMsg:  "KAITO does not support trtllm engine",
		},
		{
			name: "disaggregated mode is incompatible",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Engine: kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeVLLM},
					Serving: &kubeairunwayv1alpha1.ServingSpec{
						Mode: kubeairunwayv1alpha1.ServingModeDisaggregated,
					},
				},
			},
			wantErr: true,
			errMsg:  "KAITO does not support disaggregated serving mode",
		},
		{
			name: "aggregated mode is compatible",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Engine: kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeVLLM},
					Serving: &kubeairunwayv1alpha1.ServingSpec{
						Mode: kubeairunwayv1alpha1.ServingModeAggregated,
					},
				},
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := r.validateCompatibility(tt.md)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				if err.Error() != tt.errMsg {
					t.Errorf("expected error %q, got %q", tt.errMsg, err.Error())
				}
			} else {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
			}
		})
	}
}

func TestSetCondition(t *testing.T) {
	r := &KaitoProviderReconciler{}
	md := &kubeairunwayv1alpha1.ModelDeployment{}

	r.setCondition(md, "TestCondition", "True", "TestReason", "test message")

	if len(md.Status.Conditions) != 1 {
		t.Fatalf("expected 1 condition, got %d", len(md.Status.Conditions))
	}
	cond := md.Status.Conditions[0]
	if cond.Type != "TestCondition" {
		t.Errorf("expected type TestCondition, got %s", cond.Type)
	}
	if string(cond.Status) != "True" {
		t.Errorf("expected status True, got %s", cond.Status)
	}
	if cond.Reason != "TestReason" {
		t.Errorf("expected reason TestReason, got %s", cond.Reason)
	}
	if cond.Message != "test message" {
		t.Errorf("expected message 'test message', got %s", cond.Message)
	}

	// Update the same condition
	r.setCondition(md, "TestCondition", "False", "UpdatedReason", "updated message")
	if len(md.Status.Conditions) != 1 {
		t.Fatalf("expected 1 condition after update, got %d", len(md.Status.Conditions))
	}
	if string(md.Status.Conditions[0].Status) != "False" {
		t.Errorf("expected updated status False, got %s", md.Status.Conditions[0].Status)
	}
}

func TestNewKaitoProviderReconciler(t *testing.T) {
	r := NewKaitoProviderReconciler(nil, nil)
	if r == nil {
		t.Fatal("expected non-nil reconciler")
	}
	if r.Transformer == nil {
		t.Error("expected non-nil transformer")
	}
	if r.StatusTranslator == nil {
		t.Error("expected non-nil status translator")
	}
}

func TestControllerConstants(t *testing.T) {
	if ProviderName != "kaito" {
		t.Errorf("expected provider name 'kaito', got %s", ProviderName)
	}
	if FinalizerName != "kubeairunway.ai/kaito-provider" {
		t.Errorf("expected finalizer name 'kubeairunway.ai/kaito-provider', got %s", FinalizerName)
	}
}

func TestReconcileNotFound(t *testing.T) {
	scheme := newScheme()
	c := fake.NewClientBuilder().WithScheme(scheme).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "missing", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Requeue {
		t.Error("should not requeue for not-found")
	}
}

func TestReconcileWrongProvider(t *testing.T) {
	scheme := newScheme()
	md := newMDForController("test", "default")
	md.Status.Provider.Name = "other-provider"

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md).WithStatusSubresource(md).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Requeue {
		t.Error("should not requeue for wrong provider")
	}
}

func TestReconcilePaused(t *testing.T) {
	scheme := newScheme()
	md := newMDForController("test", "default")
	md.Annotations = map[string]string{"kubeairunway.ai/reconcile-paused": "true"}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md).WithStatusSubresource(md).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Requeue {
		t.Error("should not requeue when paused")
	}
}

func TestReconcileAddsFinalizer(t *testing.T) {
	scheme := newScheme()
	md := newMDForController("test", "default")

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md).WithStatusSubresource(md).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Requeue {
		t.Error("should requeue after adding finalizer")
	}

	// Verify finalizer was added
	var updated kubeairunwayv1alpha1.ModelDeployment
	if err := c.Get(context.Background(), types.NamespacedName{Name: "test", Namespace: "default"}, &updated); err != nil {
		t.Fatalf("failed to get updated MD: %v", err)
	}
	if !controllerutil.ContainsFinalizer(&updated, FinalizerName) {
		t.Error("expected finalizer to be added")
	}
}

func TestReconcileIncompatibleEngine(t *testing.T) {
	scheme := newScheme()
	md := newMDForController("test", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeSGLang
	controllerutil.AddFinalizer(md, FinalizerName)

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md).WithStatusSubresource(md).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	_, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var updated kubeairunwayv1alpha1.ModelDeployment
	_ = c.Get(context.Background(), types.NamespacedName{Name: "test", Namespace: "default"}, &updated)
	if updated.Status.Phase != kubeairunwayv1alpha1.DeploymentPhaseFailed {
		t.Errorf("expected Failed phase, got %s", updated.Status.Phase)
	}
}

func TestReconcileTransformFailure(t *testing.T) {
	scheme := newScheme()
	md := newMDForController("test", "default")
	// Use an engine type that passes validateCompatibility but fails in Transform
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineType("unsupported-engine")
	controllerutil.AddFinalizer(md, FinalizerName)

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md).WithStatusSubresource(md).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	_, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var updated kubeairunwayv1alpha1.ModelDeployment
	_ = c.Get(context.Background(), types.NamespacedName{Name: "test", Namespace: "default"}, &updated)
	if updated.Status.Phase != kubeairunwayv1alpha1.DeploymentPhaseFailed {
		t.Errorf("expected Failed phase, got %s", updated.Status.Phase)
	}
}

func TestReconcileNilProvider(t *testing.T) {
	scheme := newScheme()
	md := newMDForController("test", "default")
	md.Status.Provider = nil

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md).WithStatusSubresource(md).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Requeue {
		t.Error("should not requeue for nil provider")
	}
}

func TestReconcileSuccessfulCreate(t *testing.T) {
	scheme := newScheme()
	md := newMDForController("test", "default")
	controllerutil.AddFinalizer(md, FinalizerName)

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md).WithStatusSubresource(md).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.RequeueAfter != RequeueInterval {
		t.Errorf("expected requeue after %v, got %v", RequeueInterval, result.RequeueAfter)
	}

	// Verify Workspace was created
	ws := &unstructured.Unstructured{}
	setWorkspaceGVK(ws)
	err = c.Get(context.Background(), types.NamespacedName{Name: "test", Namespace: "default"}, ws)
	if err != nil {
		t.Fatalf("expected Workspace to be created: %v", err)
	}
}

func TestReconcileAlreadyRunning(t *testing.T) {
	scheme := newScheme()
	md := newMDForController("test", "default")
	controllerutil.AddFinalizer(md, FinalizerName)

	// Create an upstream workspace that matches what the transformer would produce
	// so createOrUpdateResource does NOT update it (preserving status)
	ws := &unstructured.Unstructured{}
	setWorkspaceGVK(ws)
	ws.SetName("test")
	ws.SetNamespace("default")
	ws.Object["resource"] = map[string]interface{}{
		"count": int64(1),
		"labelSelector": map[string]interface{}{
			"matchLabels": map[string]interface{}{
				"kubernetes.io/os": "linux",
			},
		},
	}
	ws.Object["inference"] = map[string]interface{}{
		"preset": map[string]interface{}{
			"name": "test-model",
		},
	}
	ws.Object["status"] = map[string]interface{}{
		"conditions": []interface{}{
			map[string]interface{}{
				"type":   "WorkspaceSucceeded",
				"status": "True",
			},
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md, ws).WithStatusSubresource(md).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.RequeueAfter != RequeueInterval {
		t.Errorf("expected requeue after %v, got %v", RequeueInterval, result.RequeueAfter)
	}

	var updated kubeairunwayv1alpha1.ModelDeployment
	_ = c.Get(context.Background(), types.NamespacedName{Name: "test", Namespace: "default"}, &updated)
	if updated.Status.Phase != kubeairunwayv1alpha1.DeploymentPhaseRunning {
		t.Errorf("expected Running phase, got %s", updated.Status.Phase)
	}
}


func TestReconcileHandleDeletion(t *testing.T) {
	scheme := newScheme()
	md := newMDForController("test", "default")
	controllerutil.AddFinalizer(md, FinalizerName)
	now := metav1.Now()
	md.DeletionTimestamp = &now

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md).WithStatusSubresource(md).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// No upstream resource exists, so finalizer should be removed
	var updated kubeairunwayv1alpha1.ModelDeployment
	_ = c.Get(context.Background(), types.NamespacedName{Name: "test", Namespace: "default"}, &updated)
	if controllerutil.ContainsFinalizer(&updated, FinalizerName) {
		t.Error("expected finalizer to be removed after deletion with no upstream resource")
	}
	_ = result
}

func TestReconcileDeletionNoFinalizer(t *testing.T) {
	scheme := newScheme()
	md := newMDForController("test", "default")
	// The handleDeletion path checks for finalizer and returns early if not present.
	// We test this by creating a MD with deletionTimestamp AND a dummy finalizer
	// (so fake client accepts it), but NOT our finalizer.
	now := metav1.Now()
	md.DeletionTimestamp = &now
	md.Finalizers = []string{"other-finalizer"}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md).WithStatusSubresource(md).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Requeue || result.RequeueAfter > 0 {
		t.Error("should not requeue when our finalizer is not present on deletion")
	}
}

func TestReconcileDeletionWithUpstreamResource(t *testing.T) {
	scheme := newScheme()
	md := newMDForController("test", "default")
	controllerutil.AddFinalizer(md, FinalizerName)
	now := metav1.Now()
	md.DeletionTimestamp = &now

	// Create upstream workspace
	ws := &unstructured.Unstructured{}
	setWorkspaceGVK(ws)
	ws.SetName("test")
	ws.SetNamespace("default")

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md, ws).WithStatusSubresource(md).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should requeue waiting for deletion
	if result.RequeueAfter != 5*time.Second {
		t.Errorf("expected requeue after 5s, got %v", result.RequeueAfter)
	}
}

func TestCreateOrUpdateResourceNew(t *testing.T) {
	scheme := newScheme()
	c := fake.NewClientBuilder().WithScheme(scheme).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	ws := &unstructured.Unstructured{}
	setWorkspaceGVK(ws)
	ws.SetName("test")
	ws.SetNamespace("default")
	ws.Object["resource"] = map[string]interface{}{"count": int64(1)}

	err := r.createOrUpdateResource(context.Background(), ws)
	if err != nil {
		t.Fatalf("unexpected error creating resource: %v", err)
	}

	// Verify it was created
	existing := &unstructured.Unstructured{}
	setWorkspaceGVK(existing)
	err = c.Get(context.Background(), types.NamespacedName{Name: "test", Namespace: "default"}, existing)
	if err != nil {
		t.Fatalf("expected resource to exist: %v", err)
	}
}

func TestCreateOrUpdateResourceUpdate(t *testing.T) {
	scheme := newScheme()

	existing := &unstructured.Unstructured{}
	setWorkspaceGVK(existing)
	existing.SetName("test")
	existing.SetNamespace("default")
	existing.Object["resource"] = map[string]interface{}{"count": int64(1)}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existing).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	// Update with different resource
	updated := &unstructured.Unstructured{}
	setWorkspaceGVK(updated)
	updated.SetName("test")
	updated.SetNamespace("default")
	updated.Object["resource"] = map[string]interface{}{"count": int64(3)}

	err := r.createOrUpdateResource(context.Background(), updated)
	if err != nil {
		t.Fatalf("unexpected error updating resource: %v", err)
	}
}

func TestCreateOrUpdateResourceNoChange(t *testing.T) {
	scheme := newScheme()

	existing := &unstructured.Unstructured{}
	setWorkspaceGVK(existing)
	existing.SetName("test")
	existing.SetNamespace("default")
	existing.Object["resource"] = map[string]interface{}{"count": int64(1)}
	existing.Object["inference"] = map[string]interface{}{"preset": map[string]interface{}{"name": "test"}}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existing).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	// Same resource
	same := &unstructured.Unstructured{}
	setWorkspaceGVK(same)
	same.SetName("test")
	same.SetNamespace("default")
	same.Object["resource"] = map[string]interface{}{"count": int64(1)}
	same.Object["inference"] = map[string]interface{}{"preset": map[string]interface{}{"name": "test"}}

	err := r.createOrUpdateResource(context.Background(), same)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSyncStatusNotFound(t *testing.T) {
	scheme := newScheme()
	c := fake.NewClientBuilder().WithScheme(scheme).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	md := &kubeairunwayv1alpha1.ModelDeployment{}
	desired := &unstructured.Unstructured{}
	setWorkspaceGVK(desired)
	desired.SetName("test")
	desired.SetNamespace("default")

	err := r.syncStatus(context.Background(), md, desired)
	if err != nil {
		t.Fatalf("unexpected error for not-found: %v", err)
	}
}

func TestSyncStatusRunning(t *testing.T) {
	scheme := newScheme()

	ws := &unstructured.Unstructured{}
	setWorkspaceGVK(ws)
	ws.SetName("test")
	ws.SetNamespace("default")
	ws.Object["status"] = map[string]interface{}{
		"conditions": []interface{}{
			map[string]interface{}{
				"type":   "WorkspaceSucceeded",
				"status": "True",
			},
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(ws).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	md := &kubeairunwayv1alpha1.ModelDeployment{}
	desired := &unstructured.Unstructured{}
	setWorkspaceGVK(desired)
	desired.SetName("test")
	desired.SetNamespace("default")

	err := r.syncStatus(context.Background(), md, desired)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if md.Status.Phase != kubeairunwayv1alpha1.DeploymentPhaseRunning {
		t.Errorf("expected Running phase, got %s", md.Status.Phase)
	}
}

func TestSyncStatusFailed(t *testing.T) {
	scheme := newScheme()

	ws := &unstructured.Unstructured{}
	setWorkspaceGVK(ws)
	ws.SetName("test")
	ws.SetNamespace("default")
	ws.Object["status"] = map[string]interface{}{
		"conditions": []interface{}{
			map[string]interface{}{
				"type":    "WorkspaceSucceeded",
				"status":  "False",
				"message": "failed",
			},
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(ws).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	md := &kubeairunwayv1alpha1.ModelDeployment{}
	desired := &unstructured.Unstructured{}
	setWorkspaceGVK(desired)
	desired.SetName("test")
	desired.SetNamespace("default")

	err := r.syncStatus(context.Background(), md, desired)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if md.Status.Phase != kubeairunwayv1alpha1.DeploymentPhaseFailed {
		t.Errorf("expected Failed phase, got %s", md.Status.Phase)
	}
}

func TestSyncStatusDeploying(t *testing.T) {
	scheme := newScheme()

	ws := &unstructured.Unstructured{}
	setWorkspaceGVK(ws)
	ws.SetName("test")
	ws.SetNamespace("default")
	ws.Object["status"] = map[string]interface{}{
		"conditions": []interface{}{
			map[string]interface{}{
				"type":   "ResourceReady",
				"status": "True",
			},
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(ws).Build()
	r := NewKaitoProviderReconciler(c, scheme)

	md := &kubeairunwayv1alpha1.ModelDeployment{}
	desired := &unstructured.Unstructured{}
	setWorkspaceGVK(desired)
	desired.SetName("test")
	desired.SetNamespace("default")

	err := r.syncStatus(context.Background(), md, desired)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if md.Status.Phase != kubeairunwayv1alpha1.DeploymentPhaseDeploying {
		t.Errorf("expected Deploying phase, got %s", md.Status.Phase)
	}
}

func setWorkspaceGVK(u *unstructured.Unstructured) {
	u.SetAPIVersion("kaito.sh/v1beta1")
	u.SetKind("Workspace")
}
