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
	"strings"
	"testing"

	kubeairunwayv1alpha1 "github.com/kaito-project/kubeairunway/controller/api/v1alpha1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func newDownloadMD(name, ns string) *kubeairunwayv1alpha1.ModelDeployment {
	size := pvcSize("100Gi")
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
							Size:       size,
							AccessMode: corev1.ReadWriteMany,
						},
					},
				},
			},
		},
	}
}

func TestNeedsDownloadJob(t *testing.T) {
	tests := []struct {
		name string
		md   *kubeairunwayv1alpha1.ModelDeployment
		want bool
	}{
		{
			name: "huggingface with modelCache volume",
			md:   newDownloadMD("test", "default"),
			want: true,
		},
		{
			name: "custom source",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Model: kubeairunwayv1alpha1.ModelSpec{
						Source: kubeairunwayv1alpha1.ModelSourceCustom,
						Storage: &kubeairunwayv1alpha1.StorageSpec{
							Volumes: []kubeairunwayv1alpha1.StorageVolume{
								{Name: "cache", Purpose: kubeairunwayv1alpha1.VolumePurposeModelCache},
							},
						},
					},
				},
			},
			want: false,
		},
		{
			name: "huggingface without modelCache volume",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Model: kubeairunwayv1alpha1.ModelSpec{
						Source: kubeairunwayv1alpha1.ModelSourceHuggingFace,
						Storage: &kubeairunwayv1alpha1.StorageSpec{
							Volumes: []kubeairunwayv1alpha1.StorageVolume{
								{Name: "custom", Purpose: kubeairunwayv1alpha1.VolumePurposeCustom},
							},
						},
					},
				},
			},
			want: false,
		},
		{
			name: "huggingface without storage",
			md: &kubeairunwayv1alpha1.ModelDeployment{
				Spec: kubeairunwayv1alpha1.ModelDeploymentSpec{
					Model: kubeairunwayv1alpha1.ModelSpec{
						Source: kubeairunwayv1alpha1.ModelSourceHuggingFace,
					},
				},
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NeedsDownloadJob(tt.md)
			if got != tt.want {
				t.Errorf("NeedsDownloadJob() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestEnsureDownloadJobCreation(t *testing.T) {
	scheme := newScheme()
	_ = batchv1.AddToScheme(scheme)

	md := newDownloadMD("my-model", "default")
	c := fake.NewClientBuilder().WithScheme(scheme).Build()

	completed, err := EnsureDownloadJob(context.Background(), c, md, DefaultDownloadJobImage)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if completed {
		t.Error("expected completed=false after creating Job")
	}

	// Verify Job was created
	job := &batchv1.Job{}
	err = c.Get(context.Background(), types.NamespacedName{
		Name:      "my-model-model-download",
		Namespace: "default",
	}, job)
	if err != nil {
		t.Fatalf("expected Job to be created: %v", err)
	}

	// Verify Job spec
	if job.Spec.Template.Spec.Containers[0].Image != DefaultDownloadJobImage {
		t.Errorf("expected image %s, got %s", DefaultDownloadJobImage, job.Spec.Template.Spec.Containers[0].Image)
	}

	// Verify env vars
	container := job.Spec.Template.Spec.Containers[0]
	foundModelName := false
	foundHFHome := false
	foundHFTransfer := false
	for _, env := range container.Env {
		switch env.Name {
		case "MODEL_NAME":
			foundModelName = true
			if env.Value != "meta-llama/Llama-2-7b-chat-hf" {
				t.Errorf("expected MODEL_NAME=%s, got %s", "meta-llama/Llama-2-7b-chat-hf", env.Value)
			}
		case "HF_HOME":
			foundHFHome = true
			if env.Value != "/model-cache" {
				t.Errorf("expected HF_HOME=/model-cache, got %s", env.Value)
			}
		case "HF_HUB_ENABLE_HF_TRANSFER":
			foundHFTransfer = true
			if env.Value != "1" {
				t.Errorf("expected HF_HUB_ENABLE_HF_TRANSFER=1, got %s", env.Value)
			}
		}
	}
	if !foundModelName {
		t.Error("expected MODEL_NAME env var")
	}
	if !foundHFHome {
		t.Error("expected HF_HOME env var")
	}
	if !foundHFTransfer {
		t.Error("expected HF_HUB_ENABLE_HF_TRANSFER env var")
	}

	// Verify volume mount
	if len(container.VolumeMounts) != 1 {
		t.Fatalf("expected 1 volume mount, got %d", len(container.VolumeMounts))
	}
	if container.VolumeMounts[0].MountPath != "/model-cache" {
		t.Errorf("expected mount path /model-cache, got %s", container.VolumeMounts[0].MountPath)
	}

	// Verify resource requests and limits
	expectedCPURequest := resource.MustParse("100m")
	if cpuReq, ok := container.Resources.Requests[corev1.ResourceCPU]; !ok {
		t.Error("expected CPU request to be set")
	} else if !cpuReq.Equal(expectedCPURequest) {
		t.Errorf("expected CPU request %s, got %s", expectedCPURequest.String(), cpuReq.String())
	}

	expectedMemoryRequest := resource.MustParse("512Mi")
	if memReq, ok := container.Resources.Requests[corev1.ResourceMemory]; !ok {
		t.Error("expected memory request to be set")
	} else if !memReq.Equal(expectedMemoryRequest) {
		t.Errorf("expected memory request %s, got %s", expectedMemoryRequest.String(), memReq.String())
	}

	expectedMemoryLimit := resource.MustParse("1Gi")
	if memLim, ok := container.Resources.Limits[corev1.ResourceMemory]; !ok {
		t.Error("expected memory limit to be set")
	} else if !memLim.Equal(expectedMemoryLimit) {
		t.Errorf("expected memory limit %s, got %s", expectedMemoryLimit.String(), memLim.String())
	}

	// Verify PVC volume
	if len(job.Spec.Template.Spec.Volumes) != 1 {
		t.Fatalf("expected 1 volume, got %d", len(job.Spec.Template.Spec.Volumes))
	}
	if job.Spec.Template.Spec.Volumes[0].PersistentVolumeClaim.ClaimName != "my-model-model-cache" {
		t.Errorf("expected PVC claim name my-model-model-cache, got %s",
			job.Spec.Template.Spec.Volumes[0].PersistentVolumeClaim.ClaimName)
	}

	// Verify labels
	if job.Labels[kubeairunwayv1alpha1.LabelJobType] != "model-download" {
		t.Error("expected job-type label")
	}
	if job.Labels[kubeairunwayv1alpha1.LabelManagedBy] != "kubeairunway" {
		t.Error("expected managed-by label")
	}

	// Verify owner reference
	if len(job.OwnerReferences) != 1 {
		t.Fatalf("expected 1 owner reference, got %d", len(job.OwnerReferences))
	}

	// Verify no envFrom (no HF token secret configured)
	if len(container.EnvFrom) != 0 {
		t.Errorf("expected no envFrom when no HF token secret, got %d", len(container.EnvFrom))
	}

	// Verify the download script does not contain pip install (dependencies are pre-installed in the image)
	downloadScript := container.Args[0]
	if strings.Contains(downloadScript, "pip install") {
		t.Error("download script should not contain 'pip install' — dependencies are pre-installed in the image")
	}

	// Verify the download script contains the hf download command
	if !strings.Contains(downloadScript, "hf download") {
		t.Error("download script should contain 'hf download'")
	}
}

func TestEnsureDownloadJobWithHFToken(t *testing.T) {
	scheme := newScheme()
	_ = batchv1.AddToScheme(scheme)

	md := newDownloadMD("my-model", "default")
	md.Spec.Secrets = &kubeairunwayv1alpha1.SecretsSpec{
		HuggingFaceToken: "hf-token-secret",
	}

	c := fake.NewClientBuilder().WithScheme(scheme).Build()

	_, err := EnsureDownloadJob(context.Background(), c, md, DefaultDownloadJobImage)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify Job was created with envFrom
	job := &batchv1.Job{}
	err = c.Get(context.Background(), types.NamespacedName{
		Name:      "my-model-model-download",
		Namespace: "default",
	}, job)
	if err != nil {
		t.Fatalf("expected Job to be created: %v", err)
	}

	container := job.Spec.Template.Spec.Containers[0]
	if len(container.EnvFrom) != 1 {
		t.Fatalf("expected 1 envFrom, got %d", len(container.EnvFrom))
	}
	if container.EnvFrom[0].SecretRef.Name != "hf-token-secret" {
		t.Errorf("expected secret ref hf-token-secret, got %s", container.EnvFrom[0].SecretRef.Name)
	}
}

func TestEnsureDownloadJobCompleted(t *testing.T) {
	scheme := newScheme()
	_ = batchv1.AddToScheme(scheme)

	md := newDownloadMD("my-model", "default")

	// Pre-create a completed Job
	existingJob := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-model-model-download",
			Namespace: "default",
		},
		Status: batchv1.JobStatus{
			Succeeded: 1,
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existingJob).WithStatusSubresource(existingJob).Build()

	completed, err := EnsureDownloadJob(context.Background(), c, md, DefaultDownloadJobImage)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !completed {
		t.Error("expected completed=true for succeeded Job")
	}
}

func TestEnsureDownloadJobStillRunning(t *testing.T) {
	scheme := newScheme()
	_ = batchv1.AddToScheme(scheme)

	md := newDownloadMD("my-model", "default")

	// Pre-create a running Job
	backoffLimit := int32(3)
	existingJob := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-model-model-download",
			Namespace: "default",
		},
		Spec: batchv1.JobSpec{
			BackoffLimit: &backoffLimit,
		},
		Status: batchv1.JobStatus{
			Active: 1,
			Failed: 1,
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existingJob).WithStatusSubresource(existingJob).Build()

	completed, err := EnsureDownloadJob(context.Background(), c, md, DefaultDownloadJobImage)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if completed {
		t.Error("expected completed=false for running Job")
	}
}

func TestEnsureDownloadJobFailed(t *testing.T) {
	scheme := newScheme()
	_ = batchv1.AddToScheme(scheme)

	md := newDownloadMD("my-model", "default")

	// Pre-create a permanently failed Job
	backoffLimit := int32(3)
	existingJob := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-model-model-download",
			Namespace: "default",
		},
		Spec: batchv1.JobSpec{
			BackoffLimit: &backoffLimit,
		},
		Status: batchv1.JobStatus{
			Failed: 4, // exceeds backoffLimit of 3
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(existingJob).WithStatusSubresource(existingJob).Build()

	_, err := EnsureDownloadJob(context.Background(), c, md, DefaultDownloadJobImage)
	if err == nil {
		t.Fatal("expected error for permanently failed Job")
	}
	if !strings.Contains(err.Error(), "failed permanently") {
		t.Errorf("expected permanent failure error, got: %v", err)
	}
}

func TestDeleteManagedJobs(t *testing.T) {
	scheme := newScheme()
	_ = batchv1.AddToScheme(scheme)

	md := &kubeairunwayv1alpha1.ModelDeployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-model",
			Namespace: "default",
		},
	}

	// Create a managed Job
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-model-model-download",
			Namespace: "default",
			Labels: map[string]string{
				kubeairunwayv1alpha1.LabelManagedBy:       "kubeairunway",
				kubeairunwayv1alpha1.LabelModelDeployment: "my-model",
			},
		},
	}
	// Create an unrelated Job
	otherJob := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "other-model-download",
			Namespace: "default",
			Labels: map[string]string{
				kubeairunwayv1alpha1.LabelManagedBy:       "kubeairunway",
				kubeairunwayv1alpha1.LabelModelDeployment: "other-model",
			},
		},
	}

	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(job, otherJob).Build()

	err := DeleteManagedJobs(context.Background(), c, md)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify our Job was deleted
	got := &batchv1.Job{}
	err = c.Get(context.Background(), types.NamespacedName{Name: "my-model-model-download", Namespace: "default"}, got)
	if err == nil {
		t.Error("expected managed Job to be deleted")
	}

	// Verify unrelated Job still exists
	err = c.Get(context.Background(), types.NamespacedName{Name: "other-model-download", Namespace: "default"}, got)
	if err != nil {
		t.Error("expected unrelated Job to still exist")
	}
}

func TestDownloadJobName(t *testing.T) {
	if downloadJobName("my-model") != "my-model-model-download" {
		t.Errorf("unexpected job name: %s", downloadJobName("my-model"))
	}
}
