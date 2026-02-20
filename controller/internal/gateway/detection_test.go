package gateway

import (
	"context"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/discovery/fake"
	k8stesting "k8s.io/client-go/testing"
)

func TestDetector_IsAvailable_AllCRDsPresent(t *testing.T) {
	dc := &fake.FakeDiscovery{
		Fake: &k8stesting.Fake{},
	}
	dc.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "inference.networking.k8s.io/v1",
			APIResources: []metav1.APIResource{
				{Name: "inferencepools"},
			},
		},
		{
			GroupVersion: "gateway.networking.k8s.io/v1",
			APIResources: []metav1.APIResource{
				{Name: "httproutes"},
				{Name: "gateways"},
			},
		},
	}

	d := NewDetector(dc)
	if !d.IsAvailable(context.Background()) {
		t.Error("expected gateway API to be available")
	}
}

func TestDetector_IsAvailable_MissingInferencePool(t *testing.T) {
	dc := &fake.FakeDiscovery{
		Fake: &k8stesting.Fake{},
	}
	dc.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "gateway.networking.k8s.io/v1",
			APIResources: []metav1.APIResource{
				{Name: "httproutes"},
				{Name: "gateways"},
			},
		},
	}

	d := NewDetector(dc)
	if d.IsAvailable(context.Background()) {
		t.Error("expected gateway API to NOT be available without InferencePool")
	}
}

func TestDetector_IsAvailable_NoCRDs(t *testing.T) {
	dc := &fake.FakeDiscovery{
		Fake: &k8stesting.Fake{},
	}
	dc.Resources = []*metav1.APIResourceList{}

	d := NewDetector(dc)
	if d.IsAvailable(context.Background()) {
		t.Error("expected gateway API to NOT be available with no CRDs")
	}
}

func TestDetector_CachesResult(t *testing.T) {
	dc := &fake.FakeDiscovery{
		Fake: &k8stesting.Fake{},
	}
	dc.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "inference.networking.k8s.io/v1",
			APIResources: []metav1.APIResource{
				{Name: "inferencepools"},
			},
		},
		{
			GroupVersion: "gateway.networking.k8s.io/v1",
			APIResources: []metav1.APIResource{
				{Name: "httproutes"},
			},
		},
	}

	d := NewDetector(dc)
	ctx := context.Background()

	// First call
	result1 := d.IsAvailable(ctx)
	// Modify resources (simulating CRD removal)
	dc.Resources = []*metav1.APIResourceList{}
	// Second call should use cached result
	result2 := d.IsAvailable(ctx)

	if result1 != result2 {
		t.Error("expected cached result to be returned")
	}
}

func TestDetector_Refresh(t *testing.T) {
	dc := &fake.FakeDiscovery{
		Fake: &k8stesting.Fake{},
	}
	dc.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "inference.networking.k8s.io/v1",
			APIResources: []metav1.APIResource{
				{Name: "inferencepools"},
			},
		},
		{
			GroupVersion: "gateway.networking.k8s.io/v1",
			APIResources: []metav1.APIResource{
				{Name: "httproutes"},
			},
		},
	}

	d := NewDetector(dc)
	ctx := context.Background()

	_ = d.IsAvailable(ctx)
	// Remove CRDs and refresh
	dc.Resources = []*metav1.APIResourceList{}
	d.Refresh()

	if d.IsAvailable(ctx) {
		t.Error("expected refreshed result to reflect removed CRDs")
	}
}

func TestDetector_ExplicitGateway(t *testing.T) {
	dc := &fake.FakeDiscovery{
		Fake: &k8stesting.Fake{},
	}

	d := NewDetector(dc)
	d.ExplicitGatewayName = "my-gateway"
	d.ExplicitGatewayNamespace = "istio-system"

	if !d.HasExplicitGateway() {
		t.Error("expected HasExplicitGateway to return true")
	}

	config, err := d.GetGatewayConfig()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if config.GatewayName != "my-gateway" || config.GatewayNamespace != "istio-system" {
		t.Errorf("unexpected config: %+v", config)
	}
}

func TestDetector_NoExplicitGateway(t *testing.T) {
	dc := &fake.FakeDiscovery{
		Fake: &k8stesting.Fake{},
	}

	d := NewDetector(dc)

	if d.HasExplicitGateway() {
		t.Error("expected HasExplicitGateway to return false")
	}

	_, err := d.GetGatewayConfig()
	if err == nil {
		t.Error("expected error when no explicit gateway configured")
	}
}
