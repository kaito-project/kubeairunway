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

package dynamo

import (
	"context"
	"testing"

	kubeairunwayv1alpha1 "github.com/kaito-project/kubeairunway/controller/api/v1alpha1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestHasManagedPVCs(t *testing.T) {
	tests := []struct {
		name string
		md   *kubeairunwayv1alpha1.ModelDeployment
		want bool
	}{
		{
			name: "no storage",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Model: kubeairunwayv1alpha1.ModelSpec{ID: "test"},
				},
			},
			want: false,
		},
		{
			name: "pre-existing PVC only",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Model: kubeairunwayv1alpha1.ModelSpec{
						ID: "test",
						Storage: &kubeairunwayv1alpha1.StorageSpec{
							Volumes: []kubeairunwayv1alpha1.StorageVolume{
								{
									Name:      "cache",
									ClaimName: "existing-pvc",
								},
							},
						},
					},
				},
			},
			want: false,
		},
		{
			name: "managed PVC with size",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Model: kubeairunwayv1alpha1.ModelSpec{
						ID: "test",
						Storage: &kubeairunwayv1alpha1.StorageSpec{
							Volumes: []kubeairunwayv1alpha1.StorageVolume{
								{
									Name: "cache",
									Size: pvcSize("100Gi"),
								},
							},
						},
					},
				},
			},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := HasManagedPVCs(tt.md)
			if got != tt.want {
				t.Errorf("HasManagedPVCs() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestEnsurePVCsCreation(t *testing.T) {
	scheme := newScheme()
	_ = corev1.AddToScheme(scheme)

	size := resource.MustParse("100Gi")
	md := &kubeairunwayv1alpha1.ModelDeployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-model",
			Namespace: "default",
			UID:       types.UID("test-uid"),
		},
		Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
			Model: kubeairunwayv1alpha1.ModelSpec{
				ID: "meta-llama/Llama-2-7b",
				Storage: &kubeairunwayv1alpha1.StorageSpec{
					Volumes: []kubeairunwayv1alpha1.StorageVolume{
						{
							Name:       "model-cache",
							Size:       &size,
							AccessMode: corev1.ReadWriteMany,
							Purpose:    kubeairunwayv1alpha1.VolumePurposeModelCache,
						},
					},
				},
			},
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).Build()
	allReady, err := EnsurePVCs(context.Background(), c, md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if allReady {
		t.Error("expected allReady=false after creating PVC (PVC is not yet Bound)")
	}

	// Verify PVC was created
	pvc := &corev1.PersistentVolumeClaim{}
	err = c.Get(context.Background(), types.NamespacedName{Name: "my-model-model-cache", Namespace: "default"}, pvc)
	if err != nil {
		t.Fatalf("expected PVC to be created: %v", err)
	}

	// Verify PVC spec
	if pvc.Spec.AccessModes[0] != corev1.ReadWriteMany {
		t.Errorf("expected ReadWriteMany, got %s", pvc.Spec.AccessModes[0])
	}
	storageReq := pvc.Spec.Resources.Requests[corev1.ResourceStorage]
	if storageReq.Cmp(size) != 0 {
		t.Errorf("expected size %s, got %s", size.String(), storageReq.String())
	}

	// Verify labels
	if pvc.Labels[kubeairunwayv1alpha1.LabelManagedBy] != "kubeairunway" {
		t.Error("expected managed-by label")
	}
	if pvc.Labels[kubeairunwayv1alpha1.LabelModelDeployment] != "my-model" {
		t.Error("expected model-deployment label")
	}

	// Verify owner reference
	if len(pvc.OwnerReferences) != 1 {
		t.Fatalf("expected 1 owner reference, got %d", len(pvc.OwnerReferences))
	}
	if pvc.OwnerReferences[0].Name != "my-model" {
		t.Errorf("expected owner name my-model, got %s", pvc.OwnerReferences[0].Name)
	}

	// Verify storageClassName is nil (cluster default)
	if pvc.Spec.StorageClassName != nil {
		t.Errorf("expected nil storageClassName, got %v", *pvc.Spec.StorageClassName)
	}
}

func stringPtr(s string) *string { return &s }

func TestEnsurePVCsWithStorageClass(t *testing.T) {
	scheme := newScheme()
	_ = corev1.AddToScheme(scheme)

	size := resource.MustParse("200Gi")
	md := &kubeairunwayv1alpha1.ModelDeployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-model",
			Namespace: "default",
			UID:       types.UID("test-uid"),
		},
		Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
			Model: kubeairunwayv1alpha1.ModelSpec{
				ID: "test-model",
				Storage: &kubeairunwayv1alpha1.StorageSpec{
					Volumes: []kubeairunwayv1alpha1.StorageVolume{
						{
							Name:             "model-cache",
							Size:             &size,
							StorageClassName: stringPtr("fast-ssd"),
							AccessMode:       corev1.ReadWriteOnce,
						},
					},
				},
			},
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).Build()
	_, err := EnsurePVCs(context.Background(), c, md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	pvc := &corev1.PersistentVolumeClaim{}
	err = c.Get(context.Background(), types.NamespacedName{Name: "my-model-model-cache", Namespace: "default"}, pvc)
	if err != nil {
		t.Fatalf("expected PVC to be created: %v", err)
	}

	if pvc.Spec.StorageClassName == nil || *pvc.Spec.StorageClassName != "fast-ssd" {
		t.Errorf("expected storageClassName fast-ssd")
	}
	if pvc.Spec.AccessModes[0] != corev1.ReadWriteOnce {
		t.Errorf("expected ReadWriteOnce, got %s", pvc.Spec.AccessModes[0])
	}
}

func TestEnsurePVCsIdempotent(t *testing.T) {
	scheme := newScheme()
	_ = corev1.AddToScheme(scheme)

	size := resource.MustParse("100Gi")
	md := &kubeairunwayv1alpha1.ModelDeployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-model",
			Namespace: "default",
			UID:       types.UID("test-uid"),
		},
		Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
			Model: kubeairunwayv1alpha1.ModelSpec{
				ID: "test-model",
				Storage: &kubeairunwayv1alpha1.StorageSpec{
					Volumes: []kubeairunwayv1alpha1.StorageVolume{
						{
							Name:       "model-cache",
							Size:       &size,
							AccessMode: corev1.ReadWriteMany,
						},
					},
				},
			},
		},
	}

	// Pre-create a bound PVC
	existingPVC := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-model-model-cache",
			Namespace: "default",
			Labels: map[string]string{
				kubeairunwayv1alpha1.LabelManagedBy:       "kubeairunway",
				kubeairunwayv1alpha1.LabelModelDeployment: "my-model",
			},
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteMany},
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{
					corev1.ResourceStorage: size,
				},
			},
		},
		Status: corev1.PersistentVolumeClaimStatus{
			Phase: corev1.ClaimBound,
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existingPVC).WithStatusSubresource(existingPVC).Build()

	allReady, err := EnsurePVCs(context.Background(), c, md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !allReady {
		t.Error("expected allReady=true for Bound PVC")
	}
}

func TestEnsurePVCsPending(t *testing.T) {
	scheme := newScheme()
	_ = corev1.AddToScheme(scheme)

	size := resource.MustParse("100Gi")
	md := &kubeairunwayv1alpha1.ModelDeployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-model",
			Namespace: "default",
			UID:       types.UID("test-uid"),
		},
		Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
			Model: kubeairunwayv1alpha1.ModelSpec{
				ID: "test-model",
				Storage: &kubeairunwayv1alpha1.StorageSpec{
					Volumes: []kubeairunwayv1alpha1.StorageVolume{
						{
							Name:       "model-cache",
							Size:       &size,
							AccessMode: corev1.ReadWriteMany,
						},
					},
				},
			},
		},
	}

	// Pre-create a pending PVC
	existingPVC := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-model-model-cache",
			Namespace: "default",
		},
		Status: corev1.PersistentVolumeClaimStatus{
			Phase: corev1.ClaimPending,
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existingPVC).WithStatusSubresource(existingPVC).Build()

	allReady, err := EnsurePVCs(context.Background(), c, md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if allReady {
		t.Error("expected allReady=false for Pending PVC")
	}
}

func TestEnsurePVCsNoStorage(t *testing.T) {
	md := &kubeairunwayv1alpha1.ModelDeployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-model",
			Namespace: "default",
		},
		Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
			Model: kubeairunwayv1alpha1.ModelSpec{ID: "test"},
		},
	}

	allReady, err := EnsurePVCs(context.Background(), nil, md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !allReady {
		t.Error("expected allReady=true when no storage")
	}
}

func TestDeleteManagedPVCs(t *testing.T) {
	scheme := newScheme()
	_ = corev1.AddToScheme(scheme)

	md := &kubeairunwayv1alpha1.ModelDeployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-model",
			Namespace: "default",
		},
	}

	// Create PVCs with matching labels
	pvc1 := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-model-cache",
			Namespace: "default",
			Labels: map[string]string{
				kubeairunwayv1alpha1.LabelManagedBy:       "kubeairunway",
				kubeairunwayv1alpha1.LabelModelDeployment: "my-model",
			},
		},
	}
	// Create an unrelated PVC
	pvc2 := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "unrelated-pvc",
			Namespace: "default",
			Labels: map[string]string{
				kubeairunwayv1alpha1.LabelManagedBy:       "kubeairunway",
				kubeairunwayv1alpha1.LabelModelDeployment: "other-model",
			},
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(pvc1, pvc2).Build()

	err := DeleteManagedPVCs(context.Background(), c, md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify our PVC was deleted
	pvc := &corev1.PersistentVolumeClaim{}
	err = c.Get(context.Background(), types.NamespacedName{Name: "my-model-cache", Namespace: "default"}, pvc)
	if err == nil {
		t.Error("expected managed PVC to be deleted")
	}

	// Verify unrelated PVC still exists
	err = c.Get(context.Background(), types.NamespacedName{Name: "unrelated-pvc", Namespace: "default"}, pvc)
	if err != nil {
		t.Error("expected unrelated PVC to still exist")
	}
}

func TestEnsurePVCsWithEmptyStorageClass(t *testing.T) {
	scheme := newScheme()
	_ = corev1.AddToScheme(scheme)

	size := resource.MustParse("100Gi")
	md := &kubeairunwayv1alpha1.ModelDeployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-model",
			Namespace: "default",
			UID:       types.UID("test-uid"),
		},
		Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
			Model: kubeairunwayv1alpha1.ModelSpec{
				ID: "test-model",
				Storage: &kubeairunwayv1alpha1.StorageSpec{
					Volumes: []kubeairunwayv1alpha1.StorageVolume{
						{
							Name:             "model-cache",
							Size:             &size,
							StorageClassName: stringPtr(""),
							AccessMode:       corev1.ReadWriteMany,
						},
					},
				},
			},
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).Build()
	_, err := EnsurePVCs(context.Background(), c, md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	pvc := &corev1.PersistentVolumeClaim{}
	err = c.Get(context.Background(), types.NamespacedName{Name: "my-model-model-cache", Namespace: "default"}, pvc)
	if err != nil {
		t.Fatalf("expected PVC to be created: %v", err)
	}

	// Verify storageClassName is non-nil and equals empty string (disables dynamic provisioning)
	if pvc.Spec.StorageClassName == nil {
		t.Fatal("expected non-nil storageClassName, got nil")
	}
	if *pvc.Spec.StorageClassName != "" {
		t.Errorf("expected empty storageClassName, got %q", *pvc.Spec.StorageClassName)
	}
}

