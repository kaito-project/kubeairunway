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
	"encoding/json"
	"testing"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/util/validation/field"
)

func TestValidateOverrides_BlocksSecurityContext(t *testing.T) {
	v := &ModelDeploymentCustomValidator{}
	overrides := map[string]interface{}{
		"securityContext": map[string]interface{}{
			"privileged": true,
		},
	}
	raw, _ := json.Marshal(overrides)
	spec := &airunwayv1alpha1.ModelDeploymentSpec{
		Provider: &airunwayv1alpha1.ProviderSpec{
			Overrides: &runtime.RawExtension{Raw: raw},
		},
	}
	errs := v.validateOverrides(spec, field.NewPath("spec"))
	if len(errs) == 0 {
		t.Fatal("expected error for securityContext override")
	}
}

func TestValidateOverrides_BlocksHostNetwork(t *testing.T) {
	v := &ModelDeploymentCustomValidator{}
	overrides := map[string]interface{}{
		"hostNetwork": true,
	}
	raw, _ := json.Marshal(overrides)
	spec := &airunwayv1alpha1.ModelDeploymentSpec{
		Provider: &airunwayv1alpha1.ProviderSpec{
			Overrides: &runtime.RawExtension{Raw: raw},
		},
	}
	errs := v.validateOverrides(spec, field.NewPath("spec"))
	if len(errs) == 0 {
		t.Fatal("expected error for hostNetwork override")
	}
}

func TestValidateOverrides_BlocksServiceAccountName(t *testing.T) {
	v := &ModelDeploymentCustomValidator{}
	overrides := map[string]interface{}{
		"serviceAccountName": "admin",
	}
	raw, _ := json.Marshal(overrides)
	spec := &airunwayv1alpha1.ModelDeploymentSpec{
		Provider: &airunwayv1alpha1.ProviderSpec{
			Overrides: &runtime.RawExtension{Raw: raw},
		},
	}
	errs := v.validateOverrides(spec, field.NewPath("spec"))
	if len(errs) == 0 {
		t.Fatal("expected error for serviceAccountName override")
	}
}

func TestValidateOverrides_BlocksNestedSecurityContext(t *testing.T) {
	v := &ModelDeploymentCustomValidator{}
	overrides := map[string]interface{}{
		"spec": map[string]interface{}{
			"securityContext": map[string]interface{}{
				"runAsRoot": true,
			},
		},
	}
	raw, _ := json.Marshal(overrides)
	spec := &airunwayv1alpha1.ModelDeploymentSpec{
		Provider: &airunwayv1alpha1.ProviderSpec{
			Overrides: &runtime.RawExtension{Raw: raw},
		},
	}
	errs := v.validateOverrides(spec, field.NewPath("spec"))
	if len(errs) == 0 {
		t.Fatal("expected error for nested securityContext override")
	}
}

func TestValidateOverrides_AllowsSafeFields(t *testing.T) {
	v := &ModelDeploymentCustomValidator{}
	overrides := map[string]interface{}{
		"replicas": 3,
		"labels": map[string]interface{}{
			"team": "ml",
		},
	}
	raw, _ := json.Marshal(overrides)
	spec := &airunwayv1alpha1.ModelDeploymentSpec{
		Provider: &airunwayv1alpha1.ProviderSpec{
			Overrides: &runtime.RawExtension{Raw: raw},
		},
	}
	errs := v.validateOverrides(spec, field.NewPath("spec"))
	if len(errs) != 0 {
		t.Fatalf("expected no errors for safe fields, got %v", errs)
	}
}

func TestValidateOverrides_NilOverrides(t *testing.T) {
	v := &ModelDeploymentCustomValidator{}
	spec := &airunwayv1alpha1.ModelDeploymentSpec{}
	errs := v.validateOverrides(spec, field.NewPath("spec"))
	if len(errs) != 0 {
		t.Fatalf("expected no errors for nil overrides, got %v", errs)
	}
}

func TestValidateOverrides_InvalidJSON(t *testing.T) {
	v := &ModelDeploymentCustomValidator{}
	spec := &airunwayv1alpha1.ModelDeploymentSpec{
		Provider: &airunwayv1alpha1.ProviderSpec{
			Overrides: &runtime.RawExtension{Raw: []byte(`{invalid`)},
		},
	}
	errs := v.validateOverrides(spec, field.NewPath("spec"))
	if len(errs) == 0 {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestValidateResourceQuantity_WithinLimits(t *testing.T) {
	errs := validateResourceQuantity("4", MaxCPU, field.NewPath("cpu"))
	if len(errs) != 0 {
		t.Fatalf("expected no errors, got %v", errs)
	}
}

func TestValidateResourceQuantity_ExceedsLimit(t *testing.T) {
	errs := validateResourceQuantity("1024", MaxCPU, field.NewPath("cpu"))
	if len(errs) == 0 {
		t.Fatal("expected error for exceeding CPU limit")
	}
}

func TestValidateResourceQuantity_ExceedsMemoryLimit(t *testing.T) {
	errs := validateResourceQuantity("8Ti", MaxMemory, field.NewPath("memory"))
	if len(errs) == 0 {
		t.Fatal("expected error for exceeding memory limit")
	}
}

func TestValidateResourceQuantity_ValidMemory(t *testing.T) {
	errs := validateResourceQuantity("256Gi", MaxMemory, field.NewPath("memory"))
	if len(errs) != 0 {
		t.Fatalf("expected no errors, got %v", errs)
	}
}

func TestValidateResourceQuantity_EmptyString(t *testing.T) {
	errs := validateResourceQuantity("", MaxCPU, field.NewPath("cpu"))
	if len(errs) != 0 {
		t.Fatalf("expected no errors for empty string, got %v", errs)
	}
}

func TestValidateResourceQuantity_InvalidFormat(t *testing.T) {
	errs := validateResourceQuantity("notanumber", MaxCPU, field.NewPath("cpu"))
	if len(errs) == 0 {
		t.Fatal("expected error for invalid resource format")
	}
}

func TestResourceCeilings_GPUCount(t *testing.T) {
	v := &ModelDeploymentCustomValidator{}
	md := &airunwayv1alpha1.ModelDeployment{
		Spec: airunwayv1alpha1.ModelDeploymentSpec{
			Model: airunwayv1alpha1.ModelSpec{ID: "test/model"},
			Resources: &airunwayv1alpha1.ResourceSpec{
				GPU: &airunwayv1alpha1.GPUSpec{Count: MaxGPUCount + 1},
			},
		},
	}
	errs := v.validateSpec(md)
	found := false
	for _, e := range errs {
		if e.Field == "spec.resources.gpu.count" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected GPU count ceiling error")
	}
}

func TestResourceCeilings_GPUCountValid(t *testing.T) {
	v := &ModelDeploymentCustomValidator{}
	md := &airunwayv1alpha1.ModelDeployment{
		Spec: airunwayv1alpha1.ModelDeploymentSpec{
			Model:  airunwayv1alpha1.ModelSpec{ID: "test/model"},
			Engine: airunwayv1alpha1.EngineSpec{Type: airunwayv1alpha1.EngineTypeVLLM},
			Resources: &airunwayv1alpha1.ResourceSpec{
				GPU: &airunwayv1alpha1.GPUSpec{Count: 8},
			},
		},
	}
	errs := v.validateSpec(md)
	for _, e := range errs {
		if e.Field == "spec.resources.gpu.count" {
			t.Fatalf("unexpected GPU count error: %v", e)
		}
	}
}
