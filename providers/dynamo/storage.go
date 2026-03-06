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
	"fmt"

	kubeairunwayv1alpha1 "github.com/kaito-project/kubeairunway/controller/api/v1alpha1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"
)

// HasManagedPVCs returns true if any volume in the ModelDeployment has Size set,
// meaning the controller is responsible for creating PVCs.
func HasManagedPVCs(md *kubeairunwayv1alpha1.ModelDeployment) bool {
	if md.Spec.Model.Storage == nil {
		return false
	}
	for _, vol := range md.Spec.Model.Storage.Volumes {
		if vol.Size != nil {
			return true
		}
	}
	return false
}

// EnsurePVCs ensures that all managed PVCs exist and are bound.
// Returns allReady=true only when ALL managed PVCs are in Bound phase.
func EnsurePVCs(ctx context.Context, c client.Client, md *kubeairunwayv1alpha1.ModelDeployment) (bool, error) {
	logger := log.FromContext(ctx)

	if md.Spec.Model.Storage == nil {
		return true, nil
	}

	allReady := true
	for _, vol := range md.Spec.Model.Storage.Volumes {
		if vol.Size == nil {
			continue // pre-existing PVC, not managed by us
		}

		claimName := vol.ResolvedClaimName(md.Name)

		// Check if PVC already exists
		existing := &corev1.PersistentVolumeClaim{}
		err := c.Get(ctx, types.NamespacedName{
			Name:      claimName,
			Namespace: md.Namespace,
		}, existing)

		if errors.IsNotFound(err) {
			// Create the PVC
			pvc, buildErr := buildPVC(md, &vol)
			if buildErr != nil {
				return false, fmt.Errorf("failed to build PVC %s: %w", claimName, buildErr)
			}
			logger.Info("Creating PVC", "name", claimName, "namespace", md.Namespace, "size", vol.Size.String())
			if createErr := c.Create(ctx, pvc); createErr != nil {
				return false, fmt.Errorf("failed to create PVC %s: %w", claimName, createErr)
			}
			allReady = false
			continue
		}
		if err != nil {
			return false, fmt.Errorf("failed to get PVC %s: %w", claimName, err)
		}

		// PVC exists, check phase
		switch existing.Status.Phase {
		case corev1.ClaimBound:
			logger.V(1).Info("PVC is Bound", "name", claimName)
		case corev1.ClaimPending:
			logger.Info("PVC is Pending", "name", claimName)
			allReady = false
		case corev1.ClaimLost:
			return false, fmt.Errorf("PVC %s is in Lost phase", claimName)
		default:
			allReady = false
		}
	}

	return allReady, nil
}

// buildPVC creates a PVC spec from a StorageVolume with Size set.
func buildPVC(md *kubeairunwayv1alpha1.ModelDeployment, vol *kubeairunwayv1alpha1.StorageVolume) (*corev1.PersistentVolumeClaim, error) {
	claimName := vol.ResolvedClaimName(md.Name)

	// Use the typed access mode directly; default to ReadWriteMany if empty
	accessMode := vol.AccessMode
	if accessMode == "" {
		accessMode = corev1.ReadWriteMany
	}

	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      claimName,
			Namespace: md.Namespace,
			Labels: map[string]string{
				kubeairunwayv1alpha1.LabelManagedBy:       "kubeairunway",
				kubeairunwayv1alpha1.LabelModelDeployment: md.Name,
			},
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: kubeairunwayv1alpha1.GroupVersion.String(),
					Kind:       "ModelDeployment",
					Name:       md.Name,
					UID:        md.UID,
					Controller: boolPtr(true),
				},
			},
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{accessMode},
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{
					corev1.ResourceStorage: *vol.Size,
				},
			},
		},
	}

	// Set storage class if specified (omit for cluster default)
	if vol.StorageClassName != "" {
		pvc.Spec.StorageClassName = &vol.StorageClassName
	}

	return pvc, nil
}

// DeleteManagedPVCs deletes all PVCs managed by the given ModelDeployment.
func DeleteManagedPVCs(ctx context.Context, c client.Client, md *kubeairunwayv1alpha1.ModelDeployment) error {
	logger := log.FromContext(ctx)

	pvcList := &corev1.PersistentVolumeClaimList{}
	if err := c.List(ctx, pvcList,
		client.InNamespace(md.Namespace),
		client.MatchingLabels{
			kubeairunwayv1alpha1.LabelManagedBy:       "kubeairunway",
			kubeairunwayv1alpha1.LabelModelDeployment: md.Name,
		},
	); err != nil {
		return fmt.Errorf("failed to list managed PVCs: %w", err)
	}

	for i := range pvcList.Items {
		pvc := &pvcList.Items[i]
		logger.Info("Deleting managed PVC", "name", pvc.Name)
		if err := c.Delete(ctx, pvc); err != nil && !errors.IsNotFound(err) {
			return fmt.Errorf("failed to delete PVC %s: %w", pvc.Name, err)
		}
	}

	return nil
}

// pvcSize is a helper to create a resource.Quantity pointer for testing
func pvcSize(s string) *resource.Quantity {
	q := resource.MustParse(s)
	return &q
}
