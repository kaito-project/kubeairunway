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

package v1alpha1

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	kubeairunwayv1alpha1 "github.com/kaito-project/kubeairunway/controller/api/v1alpha1"
	"k8s.io/apimachinery/pkg/api/resource"
)

var _ = Describe("ModelDeployment Webhook", func() {
	var (
		obj       *kubeairunwayv1alpha1.ModelDeployment
		oldObj    *kubeairunwayv1alpha1.ModelDeployment
		validator ModelDeploymentCustomValidator
		defaulter ModelDeploymentCustomDefaulter
	)

	BeforeEach(func() {
		obj = &kubeairunwayv1alpha1.ModelDeployment{}
		oldObj = &kubeairunwayv1alpha1.ModelDeployment{}
		validator = ModelDeploymentCustomValidator{}
		Expect(validator).NotTo(BeNil(), "Expected validator to be initialized")
		defaulter = ModelDeploymentCustomDefaulter{}
		Expect(defaulter).NotTo(BeNil(), "Expected defaulter to be initialized")
		Expect(oldObj).NotTo(BeNil(), "Expected oldObj to be initialized")
		Expect(obj).NotTo(BeNil(), "Expected obj to be initialized")
	})

	AfterEach(func() {
	})

	Context("When creating ModelDeployment under Defaulting Webhook", func() {
		It("Should default mountPath for modelCache purpose", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "model-data",
						ClaimName: "my-pvc",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeModelCache,
					},
				},
			}
			err := defaulter.Default(ctx, obj)
			Expect(err).NotTo(HaveOccurred())
			Expect(obj.Spec.Model.Storage.Volumes[0].MountPath).To(Equal("/model-cache"))
		})

		It("Should default mountPath for compilationCache purpose", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "compile-data",
						ClaimName: "compile-pvc",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeCompilationCache,
					},
				},
			}
			err := defaulter.Default(ctx, obj)
			Expect(err).NotTo(HaveOccurred())
			Expect(obj.Spec.Model.Storage.Volumes[0].MountPath).To(Equal("/compilation-cache"))
		})

		It("Should default purpose to custom when not specified", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "extra-data",
						ClaimName: "extra-pvc",
						MountPath: "/data",
					},
				},
			}
			err := defaulter.Default(ctx, obj)
			Expect(err).NotTo(HaveOccurred())
			Expect(obj.Spec.Model.Storage.Volumes[0].Purpose).To(Equal(kubeairunwayv1alpha1.VolumePurposeCustom))
		})

		It("Should not override explicitly set mountPath", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "model-data",
						ClaimName: "my-pvc",
						MountPath: "/custom-path",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeModelCache,
					},
				},
			}
			err := defaulter.Default(ctx, obj)
			Expect(err).NotTo(HaveOccurred())
			Expect(obj.Spec.Model.Storage.Volumes[0].MountPath).To(Equal("/custom-path"))
		})

		It("Should default claimName when size is set and claimName is empty", func() {
			obj.Name = "my-deployment"
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			size := resource.MustParse("100Gi")
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:    "model-data",
						Purpose: kubeairunwayv1alpha1.VolumePurposeModelCache,
						Size:    &size,
					},
				},
			}
			err := defaulter.Default(ctx, obj)
			Expect(err).NotTo(HaveOccurred())
			Expect(obj.Spec.Model.Storage.Volumes[0].ClaimName).To(Equal("my-deployment-model-data"))
		})

		It("Should default accessMode to ReadWriteMany when size is set", func() {
			obj.Name = "my-deployment"
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			size := resource.MustParse("100Gi")
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:    "model-data",
						Purpose: kubeairunwayv1alpha1.VolumePurposeModelCache,
						Size:    &size,
					},
				},
			}
			err := defaulter.Default(ctx, obj)
			Expect(err).NotTo(HaveOccurred())
			Expect(obj.Spec.Model.Storage.Volumes[0].AccessMode).To(Equal("ReadWriteMany"))
		})

		It("Should not override explicitly set claimName when size is set", func() {
			obj.Name = "my-deployment"
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			size := resource.MustParse("100Gi")
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "model-data",
						ClaimName: "custom-pvc-name",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeModelCache,
						Size:      &size,
					},
				},
			}
			err := defaulter.Default(ctx, obj)
			Expect(err).NotTo(HaveOccurred())
			Expect(obj.Spec.Model.Storage.Volumes[0].ClaimName).To(Equal("custom-pvc-name"))
		})

		It("Should not set accessMode defaults when size is not set", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "model-data",
						ClaimName: "existing-pvc",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeModelCache,
					},
				},
			}
			err := defaulter.Default(ctx, obj)
			Expect(err).NotTo(HaveOccurred())
			Expect(obj.Spec.Model.Storage.Volumes[0].AccessMode).To(BeEmpty())
		})
	})

	Context("When creating or updating ModelDeployment under Validating Webhook", func() {
		It("Should reject names containing dots", func() {
			obj.Name = "qwen3-0.6b"
			obj.Spec.Model.ID = "Qwen/Qwen3-0.6B"
			_, err := validator.ValidateCreate(ctx, obj)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("must not contain dots"))
		})

		It("Should admit names without dots", func() {
			obj.Name = "qwen3-0-6b"
			obj.Spec.Model.ID = "Qwen/Qwen3-0.6B"
			warnings, err := validator.ValidateCreate(ctx, obj)
			Expect(err).NotTo(HaveOccurred())
			Expect(warnings).To(BeEmpty())
		})

		It("Should admit a single modelCache volume", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "model-data",
						ClaimName: "my-pvc",
						MountPath: "/model-cache",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeModelCache,
					},
				},
			}
			warnings, err := validator.ValidateCreate(ctx, obj)
			Expect(err).NotTo(HaveOccurred())
			Expect(warnings).To(BeEmpty())
		})

		It("Should admit modelCache + compilationCache together", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "model-data",
						ClaimName: "model-pvc",
						MountPath: "/model-cache",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeModelCache,
					},
					{
						Name:      "compile-data",
						ClaimName: "compile-pvc",
						MountPath: "/compilation-cache",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeCompilationCache,
					},
				},
			}
			warnings, err := validator.ValidateCreate(ctx, obj)
			Expect(err).NotTo(HaveOccurred())
			Expect(warnings).To(BeEmpty())
		})

		It("Should admit custom volume with explicit mountPath", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "extra-data",
						ClaimName: "extra-pvc",
						MountPath: "/data/extra",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeCustom,
					},
				},
			}
			warnings, err := validator.ValidateCreate(ctx, obj)
			Expect(err).NotTo(HaveOccurred())
			Expect(warnings).To(BeEmpty())
		})

		It("Should reject duplicate volume names", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "vol",
						ClaimName: "pvc-a",
						MountPath: "/mount-a",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeCustom,
					},
					{
						Name:      "vol",
						ClaimName: "pvc-b",
						MountPath: "/mount-b",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeCustom,
					},
				},
			}
			_, err := validator.ValidateCreate(ctx, obj)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("duplicate volume name"))
		})

		It("Should reject duplicate mountPaths", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "vol-a",
						ClaimName: "pvc-a",
						MountPath: "/same-path",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeCustom,
					},
					{
						Name:      "vol-b",
						ClaimName: "pvc-b",
						MountPath: "/same-path",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeCustom,
					},
				},
			}
			_, err := validator.ValidateCreate(ctx, obj)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("duplicate mount path"))
		})

		It("Should reject duplicate claimNames", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "vol-a",
						ClaimName: "same-pvc",
						MountPath: "/mount-a",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeCustom,
					},
					{
						Name:      "vol-b",
						ClaimName: "same-pvc",
						MountPath: "/mount-b",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeCustom,
					},
				},
			}
			_, err := validator.ValidateCreate(ctx, obj)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("duplicate claim name"))
		})

		It("Should reject relative mountPath", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "vol",
						ClaimName: "pvc",
						MountPath: "relative/path",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeCustom,
					},
				},
			}
			_, err := validator.ValidateCreate(ctx, obj)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("must be an absolute path"))
		})

		It("Should reject custom purpose without explicit mountPath", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "vol",
						ClaimName: "pvc",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeCustom,
					},
				},
			}
			_, err := validator.ValidateCreate(ctx, obj)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("mountPath is required when purpose is custom"))
		})

		It("Should reject two modelCache volumes", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "cache-a",
						ClaimName: "pvc-a",
						MountPath: "/model-cache-a",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeModelCache,
					},
					{
						Name:      "cache-b",
						ClaimName: "pvc-b",
						MountPath: "/model-cache-b",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeModelCache,
					},
				},
			}
			_, err := validator.ValidateCreate(ctx, obj)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("at most one volume with purpose=modelCache"))
		})

		It("Should reject system path overlap", func() {
			systemPaths := []string{"/dev", "/proc", "/sys", "/etc", "/var/run"}
			for _, sysPath := range systemPaths {
				obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
				obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
					Volumes: []kubeairunwayv1alpha1.StorageVolume{
						{
							Name:      "vol",
							ClaimName: "pvc",
							MountPath: sysPath,
							Purpose:   kubeairunwayv1alpha1.VolumePurposeCustom,
						},
					},
				}
				_, err := validator.ValidateCreate(ctx, obj)
				Expect(err).To(HaveOccurred(), "Expected error for system path %s", sysPath)
				Expect(err.Error()).To(ContainSubstring("system path"), "Expected system path error for %s", sysPath)
			}
		})

		It("Should reject system path sub-directory", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "vol",
						ClaimName: "pvc",
						MountPath: "/proc/something",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeCustom,
					},
				},
			}
			_, err := validator.ValidateCreate(ctx, obj)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("system path"))
		})

		It("Should warn on readOnly compilationCache", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "compile-data",
						ClaimName: "compile-pvc",
						MountPath: "/compilation-cache",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeCompilationCache,
						ReadOnly:  true,
					},
				},
			}
			warnings, err := validator.ValidateCreate(ctx, obj)
			Expect(err).NotTo(HaveOccurred())
			Expect(warnings).To(HaveLen(1))
			Expect(warnings[0]).To(ContainSubstring("compilationCache"))
			Expect(warnings[0]).To(ContainSubstring("readOnly"))
		})

		It("Should admit volume with size and auto-generated claimName", func() {
			obj.Name = "my-deployment"
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			size := resource.MustParse("100Gi")
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "model-data",
						ClaimName: "my-deployment-model-data",
						MountPath: "/model-cache",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeModelCache,
						Size:      &size,
					},
				},
			}
			warnings, err := validator.ValidateCreate(ctx, obj)
			Expect(err).NotTo(HaveOccurred())
			Expect(warnings).To(BeEmpty())
		})

		It("Should admit volume with size and explicit storageClassName and claimName", func() {
			obj.Name = "my-deployment"
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			size := resource.MustParse("200Gi")
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:             "model-data",
						ClaimName:        "custom-pvc",
						MountPath:        "/model-cache",
						Purpose:          kubeairunwayv1alpha1.VolumePurposeModelCache,
						Size:             &size,
						StorageClassName: "fast-ssd",
					},
				},
			}
			warnings, err := validator.ValidateCreate(ctx, obj)
			Expect(err).NotTo(HaveOccurred())
			Expect(warnings).To(BeEmpty())
		})

		It("Should reject volume without size and without claimName", func() {
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "model-data",
						MountPath: "/model-cache",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeModelCache,
					},
				},
			}
			_, err := validator.ValidateCreate(ctx, obj)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("claimName is required when size is not set"))
		})

		It("Should reject size with readOnly true", func() {
			obj.Name = "my-deployment"
			obj.Spec.Model.ID = "meta-llama/Llama-2-7b-chat-hf"
			size := resource.MustParse("100Gi")
			obj.Spec.Model.Storage = &kubeairunwayv1alpha1.StorageSpec{
				Volumes: []kubeairunwayv1alpha1.StorageVolume{
					{
						Name:      "model-data",
						ClaimName: "my-deployment-model-data",
						MountPath: "/model-cache",
						Purpose:   kubeairunwayv1alpha1.VolumePurposeModelCache,
						Size:      &size,
						ReadOnly:  true,
					},
				},
			}
			_, err := validator.ValidateCreate(ctx, obj)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("readOnly must not be true when size is set"))
		})
	})
})
