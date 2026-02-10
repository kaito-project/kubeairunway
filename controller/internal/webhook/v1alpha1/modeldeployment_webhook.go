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
	"context"
	"fmt"

	"k8s.io/apimachinery/pkg/util/validation/field"
	ctrl "sigs.k8s.io/controller-runtime"
	logf "sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/webhook/admission"

	kubeairunwayv1alpha1 "github.com/kaito-project/kubeairunway/controller/api/v1alpha1"
)

// nolint:unused
// log is for logging in this package.
var modeldeploymentlog = logf.Log.WithName("modeldeployment-resource")

// SetupModelDeploymentWebhookWithManager registers the webhook for ModelDeployment in the manager.
func SetupModelDeploymentWebhookWithManager(mgr ctrl.Manager) error {
	return ctrl.NewWebhookManagedBy(mgr, &kubeairunwayv1alpha1.ModelDeployment{}).
		WithValidator(&ModelDeploymentCustomValidator{}).
		WithDefaulter(&ModelDeploymentCustomDefaulter{}).
		Complete()
}

// +kubebuilder:webhook:path=/mutate-kubeairunway-ai-v1alpha1-modeldeployment,mutating=true,failurePolicy=fail,sideEffects=None,groups=kubeairunway.ai,resources=modeldeployments,verbs=create;update,versions=v1alpha1,name=mmodeldeployment-v1alpha1.kb.io,admissionReviewVersions=v1

// ModelDeploymentCustomDefaulter struct is responsible for setting default values on the custom resource of the
// Kind ModelDeployment when those are created or updated.
type ModelDeploymentCustomDefaulter struct{}

// Default implements webhook.CustomDefaulter so a webhook will be registered for the Kind ModelDeployment.
func (d *ModelDeploymentCustomDefaulter) Default(_ context.Context, obj *kubeairunwayv1alpha1.ModelDeployment) error {
	modeldeploymentlog.Info("Defaulting for ModelDeployment", "name", obj.GetName())

	spec := &obj.Spec

	// Default model source to huggingface
	if spec.Model.Source == "" {
		spec.Model.Source = kubeairunwayv1alpha1.ModelSourceHuggingFace
	}

	// Default serving mode to aggregated
	if spec.Serving == nil {
		spec.Serving = &kubeairunwayv1alpha1.ServingSpec{
			Mode: kubeairunwayv1alpha1.ServingModeAggregated,
		}
	} else if spec.Serving.Mode == "" {
		spec.Serving.Mode = kubeairunwayv1alpha1.ServingModeAggregated
	}

	// Default scaling replicas to 1 for aggregated mode
	if spec.Serving.Mode == kubeairunwayv1alpha1.ServingModeAggregated {
		if spec.Scaling == nil {
			spec.Scaling = &kubeairunwayv1alpha1.ScalingSpec{
				Replicas: 1,
			}
		} else if spec.Scaling.Replicas == 0 {
			// Allow 0 for scale-to-zero, but default to 1 if not explicitly set
			// This is handled by the kubebuilder default tag
		}
	}

	// Default GPU type if GPU is specified but type is empty
	if spec.Resources != nil && spec.Resources.GPU != nil && spec.Resources.GPU.Type == "" {
		spec.Resources.GPU.Type = "nvidia.com/gpu"
	}

	// Default GPU type for disaggregated mode components
	if spec.Scaling != nil {
		if spec.Scaling.Prefill != nil && spec.Scaling.Prefill.GPU != nil && spec.Scaling.Prefill.GPU.Type == "" {
			spec.Scaling.Prefill.GPU.Type = "nvidia.com/gpu"
		}
		if spec.Scaling.Decode != nil && spec.Scaling.Decode.GPU != nil && spec.Scaling.Decode.GPU.Type == "" {
			spec.Scaling.Decode.GPU.Type = "nvidia.com/gpu"
		}
	}

	return nil
}

// +kubebuilder:webhook:path=/validate-kubeairunway-ai-v1alpha1-modeldeployment,mutating=false,failurePolicy=fail,sideEffects=None,groups=kubeairunway.ai,resources=modeldeployments,verbs=create;update,versions=v1alpha1,name=vmodeldeployment-v1alpha1.kb.io,admissionReviewVersions=v1

// ModelDeploymentCustomValidator struct is responsible for validating the ModelDeployment resource
// when it is created, updated, or deleted.
type ModelDeploymentCustomValidator struct{}

// ValidateCreate implements webhook.CustomValidator so a webhook will be registered for the type ModelDeployment.
func (v *ModelDeploymentCustomValidator) ValidateCreate(_ context.Context, obj *kubeairunwayv1alpha1.ModelDeployment) (admission.Warnings, error) {
	modeldeploymentlog.Info("Validation for ModelDeployment upon creation", "name", obj.GetName())

	var warnings admission.Warnings
	var allErrs field.ErrorList

	// Validate the spec
	allErrs = append(allErrs, v.validateSpec(obj)...)

	// Check for warnings
	warnings = append(warnings, v.checkWarnings(obj)...)

	if len(allErrs) > 0 {
		return warnings, allErrs.ToAggregate()
	}
	return warnings, nil
}

// ValidateUpdate implements webhook.CustomValidator so a webhook will be registered for the type ModelDeployment.
func (v *ModelDeploymentCustomValidator) ValidateUpdate(_ context.Context, oldObj, newObj *kubeairunwayv1alpha1.ModelDeployment) (admission.Warnings, error) {
	modeldeploymentlog.Info("Validation for ModelDeployment upon update", "name", newObj.GetName())

	var warnings admission.Warnings
	var allErrs field.ErrorList

	// Validate the spec
	allErrs = append(allErrs, v.validateSpec(newObj)...)

	// Validate immutable fields (identity fields that trigger delete+recreate)
	allErrs = append(allErrs, v.validateImmutableFields(oldObj, newObj)...)

	// Check for warnings
	warnings = append(warnings, v.checkWarnings(newObj)...)

	if len(allErrs) > 0 {
		return warnings, allErrs.ToAggregate()
	}
	return warnings, nil
}

// ValidateDelete implements webhook.CustomValidator so a webhook will be registered for the type ModelDeployment.
func (v *ModelDeploymentCustomValidator) ValidateDelete(_ context.Context, obj *kubeairunwayv1alpha1.ModelDeployment) (admission.Warnings, error) {
	modeldeploymentlog.Info("Validation for ModelDeployment upon deletion", "name", obj.GetName())

	// No validation on delete
	return nil, nil
}

// validateSpec validates the ModelDeployment spec
func (v *ModelDeploymentCustomValidator) validateSpec(obj *kubeairunwayv1alpha1.ModelDeployment) field.ErrorList {
	var allErrs field.ErrorList
	spec := &obj.Spec
	specPath := field.NewPath("spec")

	// Validate model.id is required for huggingface source
	if spec.Model.Source == kubeairunwayv1alpha1.ModelSourceHuggingFace || spec.Model.Source == "" {
		if spec.Model.ID == "" {
			allErrs = append(allErrs, field.Required(
				specPath.Child("model", "id"),
				"model.id is required when source is huggingface",
			))
		}
	}

	// Validate engine type is set
	if spec.Engine.Type == "" {
		allErrs = append(allErrs, field.Required(
			specPath.Child("engine", "type"),
			"engine.type is required",
		))
	}

	// Validate GPU requirements for certain engines
	gpuCount := int32(0)
	if spec.Resources != nil && spec.Resources.GPU != nil {
		gpuCount = spec.Resources.GPU.Count
	}

	servingMode := kubeairunwayv1alpha1.ServingModeAggregated
	if spec.Serving != nil && spec.Serving.Mode != "" {
		servingMode = spec.Serving.Mode
	}

	switch spec.Engine.Type {
	case kubeairunwayv1alpha1.EngineTypeVLLM, kubeairunwayv1alpha1.EngineTypeSGLang, kubeairunwayv1alpha1.EngineTypeTRTLLM:
		// These engines require GPU (unless in disaggregated mode with component-level GPUs)
		if servingMode == kubeairunwayv1alpha1.ServingModeAggregated && gpuCount == 0 {
			allErrs = append(allErrs, field.Invalid(
				specPath.Child("resources", "gpu", "count"),
				gpuCount,
				fmt.Sprintf("%s engine requires GPU (set resources.gpu.count > 0)", spec.Engine.Type),
			))
		}
	}

	// Validate disaggregated mode configuration
	if servingMode == kubeairunwayv1alpha1.ServingModeDisaggregated {
		// Cannot specify resources.gpu in disaggregated mode
		if spec.Resources != nil && spec.Resources.GPU != nil && spec.Resources.GPU.Count > 0 {
			allErrs = append(allErrs, field.Invalid(
				specPath.Child("resources", "gpu"),
				spec.Resources.GPU,
				"cannot specify both resources.gpu and scaling.prefill/decode in disaggregated mode",
			))
		}

		// Must specify prefill and decode
		if spec.Scaling == nil {
			allErrs = append(allErrs, field.Required(
				specPath.Child("scaling"),
				"disaggregated mode requires scaling configuration",
			))
		} else {
			if spec.Scaling.Prefill == nil {
				allErrs = append(allErrs, field.Required(
					specPath.Child("scaling", "prefill"),
					"disaggregated mode requires scaling.prefill",
				))
			} else {
				if spec.Scaling.Prefill.GPU == nil || spec.Scaling.Prefill.GPU.Count == 0 {
					allErrs = append(allErrs, field.Required(
						specPath.Child("scaling", "prefill", "gpu", "count"),
						"disaggregated mode requires scaling.prefill.gpu.count > 0",
					))
				}
			}

			if spec.Scaling.Decode == nil {
				allErrs = append(allErrs, field.Required(
					specPath.Child("scaling", "decode"),
					"disaggregated mode requires scaling.decode",
				))
			} else {
				if spec.Scaling.Decode.GPU == nil || spec.Scaling.Decode.GPU.Count == 0 {
					allErrs = append(allErrs, field.Required(
						specPath.Child("scaling", "decode", "gpu", "count"),
						"disaggregated mode requires scaling.decode.gpu.count > 0",
					))
				}
			}
		}
	}

	return allErrs
}

// validateImmutableFields checks if any immutable (identity) fields have been changed
// Changing these fields triggers a delete+recreate of the provider resource
func (v *ModelDeploymentCustomValidator) validateImmutableFields(oldObj, newObj *kubeairunwayv1alpha1.ModelDeployment) field.ErrorList {
	var allErrs field.ErrorList
	specPath := field.NewPath("spec")

	oldSpec := &oldObj.Spec
	newSpec := &newObj.Spec

	// model.id is an identity field
	if oldSpec.Model.ID != newSpec.Model.ID {
		allErrs = append(allErrs, field.Invalid(
			specPath.Child("model", "id"),
			newSpec.Model.ID,
			"model.id is immutable (changing it requires delete and recreate)",
		))
	}

	// model.source is an identity field
	if oldSpec.Model.Source != newSpec.Model.Source {
		allErrs = append(allErrs, field.Invalid(
			specPath.Child("model", "source"),
			newSpec.Model.Source,
			"model.source is immutable (changing it requires delete and recreate)",
		))
	}

	// engine.type is an identity field
	if oldSpec.Engine.Type != newSpec.Engine.Type {
		allErrs = append(allErrs, field.Invalid(
			specPath.Child("engine", "type"),
			newSpec.Engine.Type,
			"engine.type is immutable (changing it requires delete and recreate)",
		))
	}

	// provider.name is an identity field (once set)
	oldProvider := ""
	newProvider := ""
	if oldSpec.Provider != nil {
		oldProvider = oldSpec.Provider.Name
	}
	if newSpec.Provider != nil {
		newProvider = newSpec.Provider.Name
	}
	if oldProvider != "" && newProvider != "" && oldProvider != newProvider {
		allErrs = append(allErrs, field.Invalid(
			specPath.Child("provider", "name"),
			newProvider,
			"provider.name is immutable (changing it requires delete and recreate)",
		))
	}

	// serving.mode is an identity field
	oldMode := kubeairunwayv1alpha1.ServingModeAggregated
	newMode := kubeairunwayv1alpha1.ServingModeAggregated
	if oldSpec.Serving != nil && oldSpec.Serving.Mode != "" {
		oldMode = oldSpec.Serving.Mode
	}
	if newSpec.Serving != nil && newSpec.Serving.Mode != "" {
		newMode = newSpec.Serving.Mode
	}
	if oldMode != newMode {
		allErrs = append(allErrs, field.Invalid(
			specPath.Child("serving", "mode"),
			newMode,
			"serving.mode is immutable (changing it requires delete and recreate)",
		))
	}

	return allErrs
}

// checkWarnings returns non-fatal warnings for the spec
func (v *ModelDeploymentCustomValidator) checkWarnings(obj *kubeairunwayv1alpha1.ModelDeployment) admission.Warnings {
	var warnings admission.Warnings
	spec := &obj.Spec

	// Warn if servedName is specified with custom source
	if spec.Model.Source == kubeairunwayv1alpha1.ModelSourceCustom && spec.Model.ServedName != "" {
		warnings = append(warnings, "servedName is ignored for custom source (model name is defined by the container)")
	}

	// Warn if trustRemoteCode is true
	if spec.Engine.TrustRemoteCode {
		warnings = append(warnings, "trustRemoteCode=true allows execution of arbitrary code from HuggingFace")
	}

	// Warn if contextLength is set for trtllm
	if spec.Engine.Type == kubeairunwayv1alpha1.EngineTypeTRTLLM && spec.Engine.ContextLength != nil {
		warnings = append(warnings, "contextLength is ignored for TensorRT-LLM (must be configured at engine build time)")
	}

	return warnings
}
