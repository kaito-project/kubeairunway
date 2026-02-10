package dynamo

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
			Model:     kubeairunwayv1alpha1.ModelSpec{ID: "test-model", Source: kubeairunwayv1alpha1.ModelSourceHuggingFace},
			Engine:    kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeVLLM},
			Resources: &kubeairunwayv1alpha1.ResourceSpec{GPU: &kubeairunwayv1alpha1.GPUSpec{Count: 1}},
		},
		Status: kubeairunwayv1alpha1.ModelDeploymentStatus{
			Provider: &kubeairunwayv1alpha1.ProviderStatus{Name: ProviderName},
		},
	}
}

func setDGDGVK(u *unstructured.Unstructured) {
	u.SetAPIVersion("nvidia.com/v1alpha1")
	u.SetKind("DynamoGraphDeployment")
}

func TestValidateCompatibility(t *testing.T) {
	r := &DynamoProviderReconciler{}

	tests := []struct {
		name    string
		md      *kubeairunwayv1alpha1.ModelDeployment
		wantErr bool
		errMsg  string
	}{
		{
			name: "vllm with GPU is compatible",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Engine:    kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeVLLM},
					Resources: &kubeairunwayv1alpha1.ResourceSpec{GPU: &kubeairunwayv1alpha1.GPUSpec{Count: 1}},
				},
			},
			wantErr: false,
		},
		{
			name: "sglang with GPU is compatible",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Engine:    kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeSGLang},
					Resources: &kubeairunwayv1alpha1.ResourceSpec{GPU: &kubeairunwayv1alpha1.GPUSpec{Count: 1}},
				},
			},
			wantErr: false,
		},
		{
			name: "trtllm with GPU is compatible",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Engine:    kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeTRTLLM},
					Resources: &kubeairunwayv1alpha1.ResourceSpec{GPU: &kubeairunwayv1alpha1.GPUSpec{Count: 1}},
				},
			},
			wantErr: false,
		},
		{
			name: "llamacpp is incompatible",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Engine:    kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeLlamaCpp},
					Resources: &kubeairunwayv1alpha1.ResourceSpec{GPU: &kubeairunwayv1alpha1.GPUSpec{Count: 1}},
				},
			},
			wantErr: true,
			errMsg:  "Dynamo does not support llamacpp engine",
		},
		{
			name: "no GPU is incompatible",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Engine: kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeVLLM},
				},
			},
			wantErr: true,
			errMsg:  "Dynamo requires GPU (set resources.gpu.count > 0)",
		},
		{
			name: "disaggregated with prefill GPU is compatible",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Engine: kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeVLLM},
					Serving: &kubeairunwayv1alpha1.ServingSpec{
						Mode: kubeairunwayv1alpha1.ServingModeDisaggregated,
					},
					Scaling: &kubeairunwayv1alpha1.ScalingSpec{
						Prefill: &kubeairunwayv1alpha1.ComponentScalingSpec{
							GPU: &kubeairunwayv1alpha1.GPUSpec{Count: 2},
						},
					},
				},
			},
			wantErr: false,
		},
		{
			name: "disaggregated without GPU is incompatible",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Engine: kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeVLLM},
					Serving: &kubeairunwayv1alpha1.ServingSpec{
						Mode: kubeairunwayv1alpha1.ServingModeDisaggregated,
					},
					Scaling: &kubeairunwayv1alpha1.ScalingSpec{},
				},
			},
			wantErr: true,
			errMsg:  "Dynamo requires GPU (set resources.gpu.count > 0)",
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
	r := &DynamoProviderReconciler{}
	md := &kubeairunwayv1alpha1.ModelDeployment{}

	r.setCondition(md, "TestCondition", "True", "TestReason", "test message")
	if len(md.Status.Conditions) != 1 {
		t.Fatalf("expected 1 condition, got %d", len(md.Status.Conditions))
	}

	r.setCondition(md, "TestCondition", "False", "Updated", "updated")
	if len(md.Status.Conditions) != 1 {
		t.Fatalf("expected 1 condition after update, got %d", len(md.Status.Conditions))
	}
	if string(md.Status.Conditions[0].Status) != "False" {
		t.Errorf("expected False after update")
	}
}

func TestNewDynamoProviderReconciler(t *testing.T) {
	r := NewDynamoProviderReconciler(nil, nil)
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
	if ProviderName != "dynamo" {
		t.Errorf("expected provider name 'dynamo', got %s", ProviderName)
	}
	if FinalizerName != "kubeairunway.ai/dynamo-provider" {
		t.Errorf("expected finalizer 'kubeairunway.ai/dynamo-provider', got %s", FinalizerName)
	}
}

func TestReconcileNotFound(t *testing.T) {
	scheme := newScheme()
	c := fake.NewClientBuilder().WithScheme(scheme).Build()
	r := NewDynamoProviderReconciler(c, scheme)

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
	md.Status.Provider.Name = "other"

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md).WithStatusSubresource(md).Build()
	r := NewDynamoProviderReconciler(c, scheme)

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
	r := NewDynamoProviderReconciler(c, scheme)

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
	r := NewDynamoProviderReconciler(c, scheme)

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Requeue {
		t.Error("should requeue after adding finalizer")
	}

	var updated kubeairunwayv1alpha1.ModelDeployment
	_ = c.Get(context.Background(), types.NamespacedName{Name: "test", Namespace: "default"}, &updated)
	if !controllerutil.ContainsFinalizer(&updated, FinalizerName) {
		t.Error("expected finalizer to be added")
	}
}

func TestReconcileIncompatibleEngine(t *testing.T) {
	scheme := newScheme()
	md := newMDForController("test", "default")
	md.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeLlamaCpp
	controllerutil.AddFinalizer(md, FinalizerName)

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md).WithStatusSubresource(md).Build()
	r := NewDynamoProviderReconciler(c, scheme)

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
	r := NewDynamoProviderReconciler(c, scheme)

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
	r := NewDynamoProviderReconciler(c, scheme)

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.RequeueAfter != RequeueInterval {
		t.Errorf("expected requeue after %v, got %v", RequeueInterval, result.RequeueAfter)
	}

	dgd := &unstructured.Unstructured{}
	setDGDGVK(dgd)
	err = c.Get(context.Background(), types.NamespacedName{Name: "test", Namespace: DynamoNamespace}, dgd)
	if err != nil {
		t.Fatalf("expected DynamoGraphDeployment to be created: %v", err)
	}
}

func TestReconcileHandleDeletion(t *testing.T) {
	scheme := newScheme()
	md := newMDForController("test", "default")
	controllerutil.AddFinalizer(md, FinalizerName)
	now := metav1.Now()
	md.DeletionTimestamp = &now

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md).WithStatusSubresource(md).Build()
	r := NewDynamoProviderReconciler(c, scheme)

	_, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var updated kubeairunwayv1alpha1.ModelDeployment
	_ = c.Get(context.Background(), types.NamespacedName{Name: "test", Namespace: "default"}, &updated)
	if controllerutil.ContainsFinalizer(&updated, FinalizerName) {
		t.Error("expected finalizer to be removed")
	}
}

func TestReconcileDeletionNoFinalizer(t *testing.T) {
	scheme := newScheme()
	md := newMDForController("test", "default")
	now := metav1.Now()
	md.DeletionTimestamp = &now
	md.Finalizers = []string{"other-finalizer"}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md).WithStatusSubresource(md).Build()
	r := NewDynamoProviderReconciler(c, scheme)

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

	dgd := &unstructured.Unstructured{}
	setDGDGVK(dgd)
	dgd.SetName("test")
	dgd.SetNamespace(DynamoNamespace)

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md, dgd).WithStatusSubresource(md).Build()
	r := NewDynamoProviderReconciler(c, scheme)

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.RequeueAfter != 5*time.Second {
		t.Errorf("expected requeue after 5s, got %v", result.RequeueAfter)
	}
}

func TestCreateOrUpdateResourceNew(t *testing.T) {
	scheme := newScheme()
	c := fake.NewClientBuilder().WithScheme(scheme).Build()
	r := NewDynamoProviderReconciler(c, scheme)

	dgd := &unstructured.Unstructured{}
	setDGDGVK(dgd)
	dgd.SetName("test")
	dgd.SetNamespace("default")
	dgd.Object["spec"] = map[string]interface{}{"backendFramework": "vllm"}

	err := r.createOrUpdateResource(context.Background(), dgd)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCreateOrUpdateResourceUpdate(t *testing.T) {
	scheme := newScheme()

	existing := &unstructured.Unstructured{}
	setDGDGVK(existing)
	existing.SetName("test")
	existing.SetNamespace("default")
	existing.Object["spec"] = map[string]interface{}{"backendFramework": "vllm"}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existing).Build()
	r := NewDynamoProviderReconciler(c, scheme)

	updated := &unstructured.Unstructured{}
	setDGDGVK(updated)
	updated.SetName("test")
	updated.SetNamespace("default")
	updated.Object["spec"] = map[string]interface{}{"backendFramework": "sglang"}

	err := r.createOrUpdateResource(context.Background(), updated)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCreateOrUpdateResourceNoChange(t *testing.T) {
	scheme := newScheme()

	existing := &unstructured.Unstructured{}
	setDGDGVK(existing)
	existing.SetName("test")
	existing.SetNamespace("default")
	existing.Object["spec"] = map[string]interface{}{"backendFramework": "vllm"}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existing).Build()
	r := NewDynamoProviderReconciler(c, scheme)

	same := &unstructured.Unstructured{}
	setDGDGVK(same)
	same.SetName("test")
	same.SetNamespace("default")
	same.Object["spec"] = map[string]interface{}{"backendFramework": "vllm"}

	err := r.createOrUpdateResource(context.Background(), same)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSyncStatusNotFound(t *testing.T) {
	scheme := newScheme()
	c := fake.NewClientBuilder().WithScheme(scheme).Build()
	r := NewDynamoProviderReconciler(c, scheme)

	md := &kubeairunwayv1alpha1.ModelDeployment{}
	desired := &unstructured.Unstructured{}
	setDGDGVK(desired)
	desired.SetName("test")
	desired.SetNamespace("default")

	err := r.syncStatus(context.Background(), md, desired)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSyncStatusRunning(t *testing.T) {
	scheme := newScheme()

	dgd := &unstructured.Unstructured{}
	setDGDGVK(dgd)
	dgd.SetName("test")
	dgd.SetNamespace("default")
	dgd.Object["status"] = map[string]interface{}{"state": "successful"}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(dgd).Build()
	r := NewDynamoProviderReconciler(c, scheme)

	md := &kubeairunwayv1alpha1.ModelDeployment{}
	desired := &unstructured.Unstructured{}
	setDGDGVK(desired)
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

	dgd := &unstructured.Unstructured{}
	setDGDGVK(dgd)
	dgd.SetName("test")
	dgd.SetNamespace("default")
	dgd.Object["status"] = map[string]interface{}{"state": "failed", "message": "oom"}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(dgd).Build()
	r := NewDynamoProviderReconciler(c, scheme)

	md := &kubeairunwayv1alpha1.ModelDeployment{}
	desired := &unstructured.Unstructured{}
	setDGDGVK(desired)
	desired.SetName("test")
	desired.SetNamespace("default")

	err := r.syncStatus(context.Background(), md, desired)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if md.Status.Phase != kubeairunwayv1alpha1.DeploymentPhaseFailed {
		t.Errorf("expected Failed, got %s", md.Status.Phase)
	}
}

func TestSyncStatusDeploying(t *testing.T) {
	scheme := newScheme()

	dgd := &unstructured.Unstructured{}
	setDGDGVK(dgd)
	dgd.SetName("test")
	dgd.SetNamespace("default")
	dgd.Object["status"] = map[string]interface{}{"state": "deploying"}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(dgd).Build()
	r := NewDynamoProviderReconciler(c, scheme)

	md := &kubeairunwayv1alpha1.ModelDeployment{}
	desired := &unstructured.Unstructured{}
	setDGDGVK(desired)
	desired.SetName("test")
	desired.SetNamespace("default")

	err := r.syncStatus(context.Background(), md, desired)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if md.Status.Phase != kubeairunwayv1alpha1.DeploymentPhaseDeploying {
		t.Errorf("expected Deploying, got %s", md.Status.Phase)
	}
}
