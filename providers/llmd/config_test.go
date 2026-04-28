package llmd

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

	// Engines
	engines := spec.Capabilities.Engines
	if len(engines) == 0 {
		t.Fatal("expected at least one engine")
	}

	// Verify per-engine capabilities
	vllmCap := spec.Capabilities.GetEngineCapability(airunwayv1alpha1.EngineTypeVLLM)
	if vllmCap == nil {
		t.Fatal("expected vllm engine capability")
	}
	if !vllmCap.GPUSupport {
		t.Error("expected vllm GPU support to be true")
	}
	if vllmCap.CPUSupport {
		t.Error("expected vllm CPU support to be false")
	}

	// Serving modes (per-engine)
	hasAggregated := false
	hasDisaggregated := false
	for _, m := range vllmCap.ServingModes {
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
	if !hasDisaggregated {
		t.Error("expected disaggregated serving mode")
	}

	// No auto-selection rules
	if len(spec.SelectionRules) != 0 {
		t.Errorf("expected no selection rules (never auto-selected), got %d", len(spec.SelectionRules))
	}

	// Installation info
	if spec.Installation == nil {
		t.Fatal("expected installation info")
	}
	if spec.Installation.Description == "" {
		t.Error("expected non-empty description")
	}
	if len(spec.Installation.Steps) == 0 {
		t.Error("expected installation steps")
	}

	// Documentation
	if spec.Documentation == "" {
		t.Error("expected documentation URL")
	}
}
