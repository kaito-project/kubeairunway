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
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"
)

const (
	// DefaultDownloadJobImage is the default container image for model download jobs
	DefaultDownloadJobImage = "python:3.10-slim"

	// downloadJobSuffix is the suffix appended to the ModelDeployment name to form the Job name
	downloadJobSuffix = "-model-download"

	// defaultBackoffLimit is the number of retries for the download Job
	defaultBackoffLimit int32 = 3

	// Resource defaults for the download Job container.
	// The download job runs pip install + hf_transfer (HTTP streaming to disk),
	// so its resource needs are predictable and I/O-bound rather than CPU/memory-bound.
	defaultDownloadJobCPURequest    = "100m"
	defaultDownloadJobMemoryRequest = "512Mi"
	defaultDownloadJobMemoryLimit   = "1Gi"
)

// NeedsDownloadJob returns true when a model download Job should be created:
// - Model source is huggingface
// - A volume with purpose=modelCache exists
func NeedsDownloadJob(md *kubeairunwayv1alpha1.ModelDeployment) bool {
	if md.Spec.Model.Source != kubeairunwayv1alpha1.ModelSourceHuggingFace {
		return false
	}
	return findModelCacheVolume(md) != nil
}

// findModelCacheVolume returns the first volume with purpose=modelCache, or nil.
func findModelCacheVolume(md *kubeairunwayv1alpha1.ModelDeployment) *kubeairunwayv1alpha1.StorageVolume {
	if md.Spec.Model.Storage == nil {
		return nil
	}
	for i, vol := range md.Spec.Model.Storage.Volumes {
		if vol.Purpose == kubeairunwayv1alpha1.VolumePurposeModelCache {
			return &md.Spec.Model.Storage.Volumes[i]
		}
	}
	return nil
}

// EnsureDownloadJob ensures a model download Job exists and tracks its completion.
// Returns completed=true when the Job has succeeded.
func EnsureDownloadJob(ctx context.Context, c client.Client, md *kubeairunwayv1alpha1.ModelDeployment, downloadJobImage string) (bool, error) {
	logger := log.FromContext(ctx)

	vol := findModelCacheVolume(md)
	if vol == nil {
		return true, nil // nothing to do
	}

	jobName := downloadJobName(md.Name)

	// Check if Job already exists
	existing := &batchv1.Job{}
	err := c.Get(ctx, types.NamespacedName{
		Name:      jobName,
		Namespace: md.Namespace,
	}, existing)

	if errors.IsNotFound(err) {
		// Create the download Job
		job := buildDownloadJob(md, vol, downloadJobImage)
		logger.Info("Creating model download Job", "name", jobName, "model", md.Spec.Model.ID)
		if createErr := c.Create(ctx, job); createErr != nil {
			return false, fmt.Errorf("failed to create download Job %s: %w", jobName, createErr)
		}
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("failed to get download Job %s: %w", jobName, err)
	}

	// Job exists, check status
	if existing.Status.Succeeded >= 1 {
		logger.Info("Model download Job completed", "name", jobName)
		return true, nil
	}

	backoffLimit := defaultBackoffLimit
	if existing.Spec.BackoffLimit != nil {
		backoffLimit = *existing.Spec.BackoffLimit
	}
	if existing.Status.Failed > backoffLimit {
		return false, fmt.Errorf("model download Job %s failed permanently (failed=%d, backoffLimit=%d)",
			jobName, existing.Status.Failed, backoffLimit)
	}

	logger.Info("Model download Job still running", "name", jobName,
		"active", existing.Status.Active, "failed", existing.Status.Failed)
	return false, nil
}

// buildDownloadJob creates a batch Job that downloads a HuggingFace model.
func buildDownloadJob(md *kubeairunwayv1alpha1.ModelDeployment, vol *kubeairunwayv1alpha1.StorageVolume, downloadJobImage string) *batchv1.Job {
	claimName := vol.ResolvedClaimName(md.Name)
	backoffLimit := defaultBackoffLimit
	completions := int32(1)
	parallelism := int32(1)

	downloadScript := `set -eux
pip install --no-cache-dir huggingface_hub hf_transfer
hf download $MODEL_NAME`

	envVars := []corev1.EnvVar{
		{
			Name:  "MODEL_NAME",
			Value: md.Spec.Model.ID,
		},
		{
			Name:  "HF_HOME",
			Value: vol.MountPath,
		},
		{
			Name:  "HF_HUB_ENABLE_HF_TRANSFER",
			Value: "1",
		},
	}

	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      downloadJobName(md.Name),
			Namespace: md.Namespace,
			Labels: map[string]string{
				kubeairunwayv1alpha1.LabelManagedBy:       "kubeairunway",
				kubeairunwayv1alpha1.LabelModelDeployment: md.Name,
				kubeairunwayv1alpha1.LabelJobType:         "model-download",
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
		Spec: batchv1.JobSpec{
			BackoffLimit: &backoffLimit,
			Completions:  &completions,
			Parallelism:  &parallelism,
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					RestartPolicy: corev1.RestartPolicyNever,
					Containers: []corev1.Container{
						{
							Name:    "model-download",
							Image:   downloadJobImage,
							Command: []string{"sh", "-c"},
							Args:    []string{downloadScript},
							Env:     envVars,
							Resources: corev1.ResourceRequirements{
								Requests: corev1.ResourceList{
									corev1.ResourceCPU:    resource.MustParse(defaultDownloadJobCPURequest),
									corev1.ResourceMemory: resource.MustParse(defaultDownloadJobMemoryRequest),
								},
								Limits: corev1.ResourceList{
									corev1.ResourceMemory: resource.MustParse(defaultDownloadJobMemoryLimit),
								},
							},
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:      "model-cache",
									MountPath: vol.MountPath,
								},
							},
						},
					},
					Volumes: []corev1.Volume{
						{
							Name: "model-cache",
							VolumeSource: corev1.VolumeSource{
								PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{
									ClaimName: claimName,
								},
							},
						},
					},
				},
			},
		},
	}

	// Add HuggingFace token secret if configured
	if md.Spec.Secrets != nil && md.Spec.Secrets.HuggingFaceToken != "" {
		job.Spec.Template.Spec.Containers[0].EnvFrom = []corev1.EnvFromSource{
			{
				SecretRef: &corev1.SecretEnvSource{
					LocalObjectReference: corev1.LocalObjectReference{
						Name: md.Spec.Secrets.HuggingFaceToken,
					},
				},
			},
		}
	}

	return job
}

// downloadJobName returns the Job name for a ModelDeployment.
func downloadJobName(mdName string) string {
	return mdName + downloadJobSuffix
}

// DeleteManagedJobs deletes all Jobs managed by the given ModelDeployment.
func DeleteManagedJobs(ctx context.Context, c client.Client, md *kubeairunwayv1alpha1.ModelDeployment) error {
	logger := log.FromContext(ctx)

	jobList := &batchv1.JobList{}
	if err := c.List(ctx, jobList,
		client.InNamespace(md.Namespace),
		client.MatchingLabels{
			kubeairunwayv1alpha1.LabelManagedBy:       "kubeairunway",
			kubeairunwayv1alpha1.LabelModelDeployment: md.Name,
		},
	); err != nil {
		return fmt.Errorf("failed to list managed Jobs: %w", err)
	}

	propagation := metav1.DeletePropagationBackground
	for i := range jobList.Items {
		job := &jobList.Items[i]
		logger.Info("Deleting managed Job", "name", job.Name)
		if err := c.Delete(ctx, job, &client.DeleteOptions{
			PropagationPolicy: &propagation,
		}); err != nil && !errors.IsNotFound(err) {
			return fmt.Errorf("failed to delete Job %s: %w", job.Name, err)
		}
	}

	return nil
}
