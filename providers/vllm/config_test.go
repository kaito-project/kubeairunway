package vllm

import (
	"testing"

	airunwayv1alpha1 "github.com/kaito-project/airunway/controller/api/v1alpha1"
)

func TestGetProviderConfigSpec(t *testing.T) {
	spec := GetProviderConfigSpec()

	// Capabilities
	if spec.Capabilities == nil {
		t.Fatal("expected non-nil capabilities")
	}
	if !spec.Capabilities.GPUSupport {
		t.Error("expected GPU support")
	}
	if spec.Capabilities.CPUSupport {
		t.Error("expected no CPU support")
	}

	// Engines
	engines := spec.Capabilities.Engines
	if len(engines) == 0 {
		t.Fatal("expected at least one engine")
	}
	hasVLLM := false
	for _, e := range engines {
		if e == airunwayv1alpha1.EngineTypeVLLM {
			hasVLLM = true
		}
	}
	if !hasVLLM {
		t.Error("expected vllm engine support")
	}

	// Serving modes
	modes := spec.Capabilities.ServingModes
	hasAggregated := false
	hasDisaggregated := false
	for _, m := range modes {
		if m == airunwayv1alpha1.ServingModeAggregated {
			hasAggregated = true
		}
		if m == airunwayv1alpha1.ServingModeDisaggregated {
			hasDisaggregated = true
		}
	}
	if !hasAggregated {
		t.Error("expected aggregated serving mode")
	}
	if hasDisaggregated {
		t.Error("did not expect disaggregated serving mode to be advertised yet")
	}

	if len(spec.SelectionRules) != 1 {
		t.Fatalf("expected one low-priority vLLM selection rule, got %d", len(spec.SelectionRules))
	}
	if spec.SelectionRules[0].Condition != "has(spec.resources.gpu) && spec.resources.gpu.count > 0 && spec.engine.type == 'vllm'" {
		t.Errorf("unexpected selection rule condition %q", spec.SelectionRules[0].Condition)
	}
	if spec.SelectionRules[0].Priority != 10 {
		t.Errorf("expected selection rule priority 10, got %d", spec.SelectionRules[0].Priority)
	}

}

func TestGetInstallationInfo(t *testing.T) {
	info := GetInstallationInfo()
	if info == nil {
		t.Fatal("expected non-nil installation info")
	}
	if info.Description == "" {
		t.Error("expected non-empty description")
	}
	if len(info.Steps) == 0 {
		t.Error("expected installation steps")
	}
}

func TestProviderDocumentation(t *testing.T) {
	if ProviderDocumentation == "" {
		t.Error("expected documentation URL")
	}
}
