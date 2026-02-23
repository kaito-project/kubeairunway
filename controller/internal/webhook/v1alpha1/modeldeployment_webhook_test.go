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
	// TODO (user): Add any additional imports if needed
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
		// TODO (user): Add any teardown logic common to all tests
	})

	Context("When creating ModelDeployment under Defaulting Webhook", func() {
		// TODO (user): Add logic for defaulting webhooks
		// Example:
		// It("Should apply defaults when a required field is empty", func() {
		//     By("simulating a scenario where defaults should be applied")
		//     obj.SomeFieldWithDefault = ""
		//     By("calling the Default method to apply defaults")
		//     defaulter.Default(ctx, obj)
		//     By("checking that the default values are set")
		//     Expect(obj.SomeFieldWithDefault).To(Equal("default_value"))
		// })
	})

	Context("When creating or updating ModelDeployment under Validating Webhook", func() {
		It("Should reject adapters with llamacpp engine", func() {
			obj.Spec.Model.ID = "test-model"
			obj.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeLlamaCpp
			obj.Spec.Adapters = []kubeairunwayv1alpha1.LoRAAdapterSpec{
				{Name: "adapter1", Source: "hf://user/adapter1"},
			}
			_, err := validator.ValidateCreate(ctx, obj)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("llamacpp"))
		})

		It("Should reject duplicate adapter names", func() {
			obj.Spec.Model.ID = "test-model"
			obj.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeVLLM
			obj.Spec.Resources = &kubeairunwayv1alpha1.ResourceSpec{
				GPU: &kubeairunwayv1alpha1.GPUSpec{Count: 1},
			}
			obj.Spec.Adapters = []kubeairunwayv1alpha1.LoRAAdapterSpec{
				{Name: "same-name", Source: "hf://user/adapter1"},
				{Name: "same-name", Source: "hf://user/adapter2"},
			}
			_, err := validator.ValidateCreate(ctx, obj)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("Duplicate"))
		})

		It("Should reject adapter source without hf:// prefix", func() {
			obj.Spec.Model.ID = "test-model"
			obj.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeVLLM
			obj.Spec.Resources = &kubeairunwayv1alpha1.ResourceSpec{
				GPU: &kubeairunwayv1alpha1.GPUSpec{Count: 1},
			}
			obj.Spec.Adapters = []kubeairunwayv1alpha1.LoRAAdapterSpec{
				{Name: "adapter1", Source: "s3://bucket/adapter1"},
			}
			_, err := validator.ValidateCreate(ctx, obj)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("hf://"))
		})

		It("Should accept valid adapters", func() {
			obj.Spec.Model.ID = "test-model"
			obj.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeVLLM
			obj.Spec.Resources = &kubeairunwayv1alpha1.ResourceSpec{
				GPU: &kubeairunwayv1alpha1.GPUSpec{Count: 1},
			}
			obj.Spec.Adapters = []kubeairunwayv1alpha1.LoRAAdapterSpec{
				{Name: "adapter1", Source: "hf://user/adapter1"},
				{Name: "adapter2", Source: "hf://user/adapter2"},
			}
			_, err := validator.ValidateCreate(ctx, obj)
			Expect(err).NotTo(HaveOccurred())
		})

		It("Should reject auto-derived adapter names that collide", func() {
			obj.Spec.Model.ID = "test-model"
			obj.Spec.Engine.Type = kubeairunwayv1alpha1.EngineTypeVLLM
			obj.Spec.Resources = &kubeairunwayv1alpha1.ResourceSpec{
				GPU: &kubeairunwayv1alpha1.GPUSpec{Count: 1},
			}
			obj.Spec.Adapters = []kubeairunwayv1alpha1.LoRAAdapterSpec{
				{Source: "hf://user/adapter1"},
				{Source: "hf://user/adapter1"},
			}
			_, err := validator.ValidateCreate(ctx, obj)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("Duplicate"))
		})
	})

})
