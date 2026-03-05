package dynamo

import (
	"context"
	"testing"
	"time"

	kubeairunwayv1alpha1 "github.com/kaito-project/kubeairunway/controller/api/v1alpha1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
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
	_ = corev1.AddToScheme(s)
	_ = batchv1.AddToScheme(s)
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
	err = c.Get(context.Background(), types.NamespacedName{Name: dynamoGraphDeploymentName("test"), Namespace: "default"}, dgd)
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
	dgd.SetName(dynamoGraphDeploymentName("test"))
	dgd.SetNamespace("default")
	dgd.SetLabels(map[string]string{
		"kubeairunway.ai/managed-by":           "kubeairunway",
	})

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

	md := &kubeairunwayv1alpha1.ModelDeployment{}
	md.Name = "test"
	md.Namespace = "default"

	dgd := &unstructured.Unstructured{}
	setDGDGVK(dgd)
	dgd.SetName("test")
	dgd.SetNamespace("default")
	dgd.Object["spec"] = map[string]interface{}{"backendFramework": "vllm"}

	err := r.createOrUpdateResource(context.Background(), dgd, md)
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
	existing.SetLabels(map[string]string{
		"kubeairunway.ai/managed-by":            "kubeairunway",
	})
	existing.Object["spec"] = map[string]interface{}{"backendFramework": "vllm"}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existing).Build()
	r := NewDynamoProviderReconciler(c, scheme)

	md := &kubeairunwayv1alpha1.ModelDeployment{}
	md.Name = "test"
	md.Namespace = "default"

	updated := &unstructured.Unstructured{}
	setDGDGVK(updated)
	updated.SetName("test")
	updated.SetNamespace("default")
	updated.Object["spec"] = map[string]interface{}{"backendFramework": "sglang"}

	err := r.createOrUpdateResource(context.Background(), updated, md)
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
	existing.SetLabels(map[string]string{
		"kubeairunway.ai/managed-by":            "kubeairunway",
	})
	existing.Object["spec"] = map[string]interface{}{"backendFramework": "vllm"}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existing).Build()
	r := NewDynamoProviderReconciler(c, scheme)

	md := &kubeairunwayv1alpha1.ModelDeployment{}
	md.Name = "test"
	md.Namespace = "default"

	same := &unstructured.Unstructured{}
	setDGDGVK(same)
	same.SetName("test")
	same.SetNamespace("default")
	same.Object["spec"] = map[string]interface{}{"backendFramework": "vllm"}

	err := r.createOrUpdateResource(context.Background(), same, md)
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

// --- 3-phase orchestration tests ---

func newMDWithStorage(name, ns string) *kubeairunwayv1alpha1.ModelDeployment {
	size := resource.MustParse("100Gi")
	return &kubeairunwayv1alpha1.ModelDeployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: ns,
			UID:       types.UID("test-uid"),
		},
		Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
			Model: kubeairunwayv1alpha1.ModelSpec{
				ID:     "meta-llama/Llama-2-7b-chat-hf",
				Source: kubeairunwayv1alpha1.ModelSourceHuggingFace,
				Storage: &kubeairunwayv1alpha1.StorageSpec{
					Volumes: []kubeairunwayv1alpha1.StorageVolume{
						{
							Name:       "model-cache",
							MountPath:  "/model-cache",
							Purpose:    kubeairunwayv1alpha1.VolumePurposeModelCache,
							Size:       &size,
							AccessMode: "ReadWriteMany",
						},
					},
				},
			},
			Engine:    kubeairunwayv1alpha1.EngineSpec{Type: kubeairunwayv1alpha1.EngineTypeVLLM},
			Resources: &kubeairunwayv1alpha1.ResourceSpec{GPU: &kubeairunwayv1alpha1.GPUSpec{Count: 1}},
		},
		Status: kubeairunwayv1alpha1.ModelDeploymentStatus{
			Provider: &kubeairunwayv1alpha1.ProviderStatus{Name: ProviderName},
		},
	}
}

func TestReconcilePVCNotBound(t *testing.T) {
	scheme := newScheme()
	md := newMDWithStorage("test", "default")
	controllerutil.AddFinalizer(md, FinalizerName)

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md).WithStatusSubresource(md).Build()
	r := NewDynamoProviderReconciler(c, scheme)

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should requeue (PVC was just created, not yet Bound)
	if result.RequeueAfter != 10*time.Second {
		t.Errorf("expected requeue after 10s, got %v", result.RequeueAfter)
	}

	// Verify PVC was created
	pvc := &corev1.PersistentVolumeClaim{}
	err = c.Get(context.Background(), types.NamespacedName{Name: "test-model-cache", Namespace: "default"}, pvc)
	if err != nil {
		t.Fatalf("expected PVC to be created: %v", err)
	}

	// Verify DGD was NOT created (should not proceed past PVC phase)
	dgd := &unstructured.Unstructured{}
	setDGDGVK(dgd)
	err = c.Get(context.Background(), types.NamespacedName{Name: "test", Namespace: "default"}, dgd)
	if err == nil {
		t.Error("DGD should NOT be created before PVCs are bound")
	}
}

func TestReconcileDownloadNotComplete(t *testing.T) {
	scheme := newScheme()
	md := newMDWithStorage("test", "default")
	controllerutil.AddFinalizer(md, FinalizerName)

	// Pre-create a bound PVC so we pass Phase 1
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-model-cache",
			Namespace: "default",
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteMany},
		},
		Status: corev1.PersistentVolumeClaimStatus{
			Phase: corev1.ClaimBound,
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md, pvc).WithStatusSubresource(md, pvc).Build()
	r := NewDynamoProviderReconciler(c, scheme)

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should requeue (download Job was just created, not yet complete)
	if result.RequeueAfter != 15*time.Second {
		t.Errorf("expected requeue after 15s, got %v", result.RequeueAfter)
	}

	// Verify download Job was created
	job := &batchv1.Job{}
	err = c.Get(context.Background(), types.NamespacedName{Name: "test-model-download", Namespace: "default"}, job)
	if err != nil {
		t.Fatalf("expected download Job to be created: %v", err)
	}

	// Verify DGD was NOT created
	dgd := &unstructured.Unstructured{}
	setDGDGVK(dgd)
	err = c.Get(context.Background(), types.NamespacedName{Name: "test", Namespace: "default"}, dgd)
	if err == nil {
		t.Error("DGD should NOT be created before download completes")
	}
}

func TestReconcileFullPipeline(t *testing.T) {
	scheme := newScheme()
	md := newMDWithStorage("test", "default")
	controllerutil.AddFinalizer(md, FinalizerName)

	// Pre-create bound PVC
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-model-cache",
			Namespace: "default",
		},
		Status: corev1.PersistentVolumeClaimStatus{
			Phase: corev1.ClaimBound,
		},
	}

	// Pre-create completed download Job
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-model-download",
			Namespace: "default",
		},
		Status: batchv1.JobStatus{
			Succeeded: 1,
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md, pvc, job).WithStatusSubresource(md, pvc, job).Build()
	r := NewDynamoProviderReconciler(c, scheme)

	result, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should complete and requeue for periodic sync
	if result.RequeueAfter != RequeueInterval {
		t.Errorf("expected requeue after %v, got %v", RequeueInterval, result.RequeueAfter)
	}

	// Verify DGD was created
	dgd := &unstructured.Unstructured{}
	setDGDGVK(dgd)
	err = c.Get(context.Background(), types.NamespacedName{Name: "test", Namespace: "default"}, dgd)
	if err != nil {
		t.Fatalf("expected DGD to be created: %v", err)
	}
}

func TestReconcileNoStorageSkipsPhases(t *testing.T) {
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

	// Should go straight to DGD creation (no PVC or download phases)
	if result.RequeueAfter != RequeueInterval {
		t.Errorf("expected requeue after %v, got %v", RequeueInterval, result.RequeueAfter)
	}

	// Verify DGD was created
	dgd := &unstructured.Unstructured{}
	setDGDGVK(dgd)
	err = c.Get(context.Background(), types.NamespacedName{Name: "test", Namespace: "default"}, dgd)
	if err != nil {
		t.Fatalf("expected DGD to be created: %v", err)
	}
}

func TestReconcileDeletionCleansUpResources(t *testing.T) {
	scheme := newScheme()
	md := newMDWithStorage("test", "default")
	controllerutil.AddFinalizer(md, FinalizerName)
	now := metav1.Now()
	md.DeletionTimestamp = &now

	// Create managed PVC
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-model-cache",
			Namespace: "default",
			Labels: map[string]string{
				kubeairunwayv1alpha1.LabelManagedBy:       "kubeairunway",
				kubeairunwayv1alpha1.LabelModelDeployment: "test",
			},
		},
	}

	// Create managed Job
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-model-download",
			Namespace: "default",
			Labels: map[string]string{
				kubeairunwayv1alpha1.LabelManagedBy:       "kubeairunway",
				kubeairunwayv1alpha1.LabelModelDeployment: "test",
			},
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(md, pvc, job).WithStatusSubresource(md).Build()
	r := NewDynamoProviderReconciler(c, scheme)

	_, err := r.Reconcile(context.Background(), ctrl.Request{
		NamespacedName: types.NamespacedName{Name: "test", Namespace: "default"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify managed PVC was deleted
	pvcCheck := &corev1.PersistentVolumeClaim{}
	err = c.Get(context.Background(), types.NamespacedName{Name: "test-model-cache", Namespace: "default"}, pvcCheck)
	if err == nil {
		t.Error("expected managed PVC to be deleted during cleanup")
	}

	// Verify managed Job was deleted
	jobCheck := &batchv1.Job{}
	err = c.Get(context.Background(), types.NamespacedName{Name: "test-model-download", Namespace: "default"}, jobCheck)
	if err == nil {
		t.Error("expected managed Job to be deleted during cleanup")
	}
}
