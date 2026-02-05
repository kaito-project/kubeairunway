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

package controller

import (
	"context"
	"fmt"

	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"

	kubefoundryv1alpha1 "github.com/kubefoundry/kubefoundry/controller/api/v1alpha1"
)

// ModelDeploymentReconciler reconciles a ModelDeployment object
type ModelDeploymentReconciler struct {
	client.Client
	Scheme *runtime.Scheme

	// EnableProviderSelector controls whether the controller runs provider selection
	EnableProviderSelector bool
}

// +kubebuilder:rbac:groups=kubefoundry.kubefoundry.ai,resources=modeldeployments,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=kubefoundry.kubefoundry.ai,resources=modeldeployments/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=kubefoundry.kubefoundry.ai,resources=modeldeployments/finalizers,verbs=update
// +kubebuilder:rbac:groups=kubefoundry.kubefoundry.ai,resources=inferenceproviderconfigs,verbs=get;list;watch

// Reconcile handles the reconciliation loop for ModelDeployment resources.
//
// The core controller is intentionally minimal - it does NOT create provider resources.
// Instead, it:
// 1. Validates the ModelDeployment spec
// 2. Runs provider selection (if enabled and spec.provider.name is empty)
// 3. Updates status conditions
//
// Provider controllers (out-of-tree) watch for ModelDeployments where status.provider.name
// matches their name and handle the actual resource creation.
func (r *ModelDeploymentReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	logger := log.FromContext(ctx)

	// Fetch the ModelDeployment
	var md kubefoundryv1alpha1.ModelDeployment
	if err := r.Get(ctx, req.NamespacedName, &md); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	logger.Info("Reconciling ModelDeployment", "name", md.Name, "namespace", md.Namespace)

	// Check for pause annotation
	if md.Annotations != nil && md.Annotations["kubefoundry.ai/reconcile-paused"] == "true" {
		logger.Info("Reconciliation paused", "name", md.Name)
		return ctrl.Result{}, nil
	}

	// Update observed generation
	if md.Status.ObservedGeneration != md.Generation {
		md.Status.ObservedGeneration = md.Generation
	}

	// Initialize status if needed
	if md.Status.Phase == "" {
		md.Status.Phase = kubefoundryv1alpha1.DeploymentPhasePending
	}

	// Step 1: Validate the spec
	if err := r.validateSpec(ctx, &md); err != nil {
		logger.Error(err, "Validation failed", "name", md.Name)
		r.setCondition(&md, kubefoundryv1alpha1.ConditionTypeValidated, metav1.ConditionFalse, "ValidationFailed", err.Error())
		md.Status.Phase = kubefoundryv1alpha1.DeploymentPhaseFailed
		md.Status.Message = fmt.Sprintf("Validation failed: %s", err.Error())
		return ctrl.Result{}, r.Status().Update(ctx, &md)
	}
	r.setCondition(&md, kubefoundryv1alpha1.ConditionTypeValidated, metav1.ConditionTrue, "ValidationPassed", "Schema validation passed")

	// Step 2: Run provider selection if needed
	if r.EnableProviderSelector {
		if err := r.selectProvider(ctx, &md); err != nil {
			logger.Error(err, "Provider selection failed", "name", md.Name)
			r.setCondition(&md, kubefoundryv1alpha1.ConditionTypeProviderSelected, metav1.ConditionFalse, "SelectionFailed", err.Error())
			md.Status.Message = fmt.Sprintf("Provider selection failed: %s", err.Error())
			return ctrl.Result{}, r.Status().Update(ctx, &md)
		}
	}

	// Step 3: Update status
	// If no provider is selected yet, stay in Pending
	if md.Status.Provider == nil || md.Status.Provider.Name == "" {
		if md.Spec.Provider != nil && md.Spec.Provider.Name != "" {
			// User explicitly specified a provider
			md.Status.Provider = &kubefoundryv1alpha1.ProviderStatus{
				Name:           md.Spec.Provider.Name,
				SelectedReason: "explicit provider selection",
			}
			r.setCondition(&md, kubefoundryv1alpha1.ConditionTypeProviderSelected, metav1.ConditionTrue, "ExplicitSelection", "Provider explicitly specified in spec")
		} else if !r.EnableProviderSelector {
			// No provider specified and selector disabled
			r.setCondition(&md, kubefoundryv1alpha1.ConditionTypeProviderSelected, metav1.ConditionFalse, "NoProvider", "No provider specified and provider-selector not enabled")
			md.Status.Message = "No provider specified and provider-selector not enabled"
		}
	}

	// The core controller does NOT create provider resources.
	// Provider controllers watch for ModelDeployments where status.provider.name matches
	// their name and handle the actual resource creation.
	//
	// The core controller's job is done after validation and provider selection.
	// Provider controllers will update:
	// - status.phase (Deploying, Running, Failed)
	// - status.provider.resourceName
	// - status.provider.resourceKind
	// - status.replicas
	// - status.endpoint
	// - ProviderCompatible, ResourceCreated, Ready conditions

	logger.Info("Reconciliation complete", "name", md.Name, "phase", md.Status.Phase, "provider", md.Status.Provider)

	return ctrl.Result{}, r.Status().Update(ctx, &md)
}

// validateSpec performs validation on the ModelDeployment spec
func (r *ModelDeploymentReconciler) validateSpec(ctx context.Context, md *kubefoundryv1alpha1.ModelDeployment) error {
	spec := &md.Spec

	// Validate model.id is required for huggingface source
	if spec.Model.Source == kubefoundryv1alpha1.ModelSourceHuggingFace || spec.Model.Source == "" {
		if spec.Model.ID == "" {
			return fmt.Errorf("model.id is required when source is huggingface")
		}
	}

	// Validate engine type is set
	if spec.Engine.Type == "" {
		return fmt.Errorf("engine.type is required")
	}

	// Validate GPU requirements for certain engines
	gpuCount := int32(0)
	if spec.Resources != nil && spec.Resources.GPU != nil {
		gpuCount = spec.Resources.GPU.Count
	}

	switch spec.Engine.Type {
	case kubefoundryv1alpha1.EngineTypeVLLM, kubefoundryv1alpha1.EngineTypeSGLang, kubefoundryv1alpha1.EngineTypeTRTLLM:
		// These engines require GPU (unless in disaggregated mode with component-level GPUs)
		servingMode := kubefoundryv1alpha1.ServingModeAggregated
		if spec.Serving != nil && spec.Serving.Mode != "" {
			servingMode = spec.Serving.Mode
		}

		if servingMode == kubefoundryv1alpha1.ServingModeAggregated && gpuCount == 0 {
			return fmt.Errorf("%s engine requires GPU (set resources.gpu.count > 0)", spec.Engine.Type)
		}
	}

	// Validate disaggregated mode configuration
	if spec.Serving != nil && spec.Serving.Mode == kubefoundryv1alpha1.ServingModeDisaggregated {
		// Cannot specify resources.gpu in disaggregated mode
		if spec.Resources != nil && spec.Resources.GPU != nil && spec.Resources.GPU.Count > 0 {
			return fmt.Errorf("cannot specify both resources.gpu and scaling.prefill/decode in disaggregated mode")
		}

		// Must specify prefill and decode
		if spec.Scaling == nil || spec.Scaling.Prefill == nil || spec.Scaling.Decode == nil {
			return fmt.Errorf("disaggregated mode requires scaling.prefill and scaling.decode")
		}

		// Prefill must have GPU
		if spec.Scaling.Prefill.GPU == nil || spec.Scaling.Prefill.GPU.Count == 0 {
			return fmt.Errorf("disaggregated mode requires scaling.prefill.gpu.count > 0")
		}

		// Decode must have GPU
		if spec.Scaling.Decode.GPU == nil || spec.Scaling.Decode.GPU.Count == 0 {
			return fmt.Errorf("disaggregated mode requires scaling.decode.gpu.count > 0")
		}
	}

	return nil
}

// selectProvider runs the provider selection algorithm
func (r *ModelDeploymentReconciler) selectProvider(ctx context.Context, md *kubefoundryv1alpha1.ModelDeployment) error {
	logger := log.FromContext(ctx)

	// Skip if provider is already selected (either in spec or status)
	if md.Spec.Provider != nil && md.Spec.Provider.Name != "" {
		return nil // User explicitly specified provider
	}
	if md.Status.Provider != nil && md.Status.Provider.Name != "" {
		return nil // Provider already selected
	}

	// List all InferenceProviderConfigs
	var providerConfigs kubefoundryv1alpha1.InferenceProviderConfigList
	if err := r.List(ctx, &providerConfigs); err != nil {
		return fmt.Errorf("failed to list provider configs: %w", err)
	}

	if len(providerConfigs.Items) == 0 {
		return fmt.Errorf("no providers registered (InferenceProviderConfig resources not found)")
	}

	// Filter to ready providers
	var readyProviders []kubefoundryv1alpha1.InferenceProviderConfig
	for _, pc := range providerConfigs.Items {
		if pc.Status.Ready {
			readyProviders = append(readyProviders, pc)
		}
	}

	if len(readyProviders) == 0 {
		return fmt.Errorf("no healthy providers available")
	}

	// Run selection algorithm
	selectedProvider, reason := r.runSelectionAlgorithm(md, readyProviders)
	if selectedProvider == "" {
		return fmt.Errorf("no compatible provider found for this configuration")
	}

	logger.Info("Provider selected", "provider", selectedProvider, "reason", reason)

	md.Status.Provider = &kubefoundryv1alpha1.ProviderStatus{
		Name:           selectedProvider,
		SelectedReason: reason,
	}
	r.setCondition(md, kubefoundryv1alpha1.ConditionTypeProviderSelected, metav1.ConditionTrue, "AutoSelected", fmt.Sprintf("Provider %s auto-selected", selectedProvider))

	return nil
}

// runSelectionAlgorithm implements the provider selection algorithm
// This is a simplified version - full CEL evaluation would be added for production
func (r *ModelDeploymentReconciler) runSelectionAlgorithm(md *kubefoundryv1alpha1.ModelDeployment, providers []kubefoundryv1alpha1.InferenceProviderConfig) (string, string) {
	spec := &md.Spec

	// Determine GPU requirements
	hasGPU := false
	if spec.Resources != nil && spec.Resources.GPU != nil && spec.Resources.GPU.Count > 0 {
		hasGPU = true
	}
	if spec.Serving != nil && spec.Serving.Mode == kubefoundryv1alpha1.ServingModeDisaggregated {
		// Disaggregated mode always uses GPU
		hasGPU = true
	}

	// Build candidate list with scores
	type candidate struct {
		name     string
		reason   string
		priority int32
	}
	var candidates []candidate

	for _, pc := range providers {
		caps := pc.Spec.Capabilities
		if caps == nil {
			continue
		}

		// Check engine support
		engineSupported := false
		for _, e := range caps.Engines {
			if e == spec.Engine.Type {
				engineSupported = true
				break
			}
		}
		if !engineSupported {
			continue
		}

		// Check GPU/CPU support
		if hasGPU && !caps.GPUSupport {
			continue
		}
		if !hasGPU && !caps.CPUSupport {
			continue
		}

		// Check serving mode support
		servingMode := kubefoundryv1alpha1.ServingModeAggregated
		if spec.Serving != nil && spec.Serving.Mode != "" {
			servingMode = spec.Serving.Mode
		}
		servingModeSupported := false
		for _, sm := range caps.ServingModes {
			if sm == servingMode {
				servingModeSupported = true
				break
			}
		}
		if !servingModeSupported {
			continue
		}

		// This provider is compatible
		// Calculate priority from selection rules
		priority := int32(0)
		for _, rule := range pc.Spec.SelectionRules {
			// TODO: Evaluate CEL condition
			// For now, just use the priority if there are rules
			if rule.Priority > priority {
				priority = rule.Priority
			}
		}

		reason := fmt.Sprintf("matched capabilities: engine=%s, gpu=%v, mode=%s", spec.Engine.Type, hasGPU, servingMode)
		candidates = append(candidates, candidate{
			name:     pc.Name,
			reason:   reason,
			priority: priority,
		})
	}

	if len(candidates) == 0 {
		return "", ""
	}

	// Select highest priority candidate
	best := candidates[0]
	for _, c := range candidates[1:] {
		if c.priority > best.priority {
			best = c
		}
	}

	return best.name, best.reason
}

// setCondition updates a condition on the ModelDeployment
func (r *ModelDeploymentReconciler) setCondition(md *kubefoundryv1alpha1.ModelDeployment, conditionType string, status metav1.ConditionStatus, reason, message string) {
	condition := metav1.Condition{
		Type:               conditionType,
		Status:             status,
		Reason:             reason,
		Message:            message,
		LastTransitionTime: metav1.Now(),
		ObservedGeneration: md.Generation,
	}
	meta.SetStatusCondition(&md.Status.Conditions, condition)
}

// SetupWithManager sets up the controller with the Manager.
func (r *ModelDeploymentReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&kubefoundryv1alpha1.ModelDeployment{}).
		Named("modeldeployment").
		Complete(r)
}
