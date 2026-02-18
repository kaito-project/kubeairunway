package gateway

import (
	"context"
	"fmt"
	"sync"

	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/discovery"
	"sigs.k8s.io/controller-runtime/pkg/log"
)

const (
	// InferencePoolCRDGroup is the API group for InferencePool
	InferencePoolCRDGroup = "inference.networking.k8s.io"
	// InferencePoolCRDVersion is the API version for InferencePool
	InferencePoolCRDVersion = "v1"
	// InferencePoolCRDResource is the resource name for InferencePool
	InferencePoolCRDResource = "inferencepools"

	// HTTPRouteCRDGroup is the API group for HTTPRoute
	HTTPRouteCRDGroup = "gateway.networking.k8s.io"
	// HTTPRouteCRDVersion is the API version for HTTPRoute
	HTTPRouteCRDVersion = "v1"
	// HTTPRouteCRDResource is the resource name for HTTPRoute
	HTTPRouteCRDResource = "httproutes"

	// GatewayCRDResource is the resource name for Gateway
	GatewayCRDResource = "gateways"

	// LabelInferenceGateway is the label to identify the inference gateway
	LabelInferenceGateway = "kubeairunway.ai/inference-gateway"
)

// GatewayConfig holds the resolved gateway configuration
type GatewayConfig struct {
	// GatewayName is the name of the Gateway resource to use as HTTPRoute parent
	GatewayName string
	// GatewayNamespace is the namespace of the Gateway resource
	GatewayNamespace string
}

// Detector checks for Gateway API CRD availability in the cluster
type Detector struct {
	discovery discovery.DiscoveryInterface
	mu        sync.RWMutex
	available *bool

	// Explicit gateway override from flags
	ExplicitGatewayName      string
	ExplicitGatewayNamespace string
}

// NewDetector creates a new Gateway API detector
func NewDetector(dc discovery.DiscoveryInterface) *Detector {
	return &Detector{
		discovery: dc,
	}
}

// IsAvailable checks if the Gateway API Inference Extension CRDs are installed.
// Results are cached after first check.
func (d *Detector) IsAvailable(ctx context.Context) bool {
	d.mu.RLock()
	if d.available != nil {
		result := *d.available
		d.mu.RUnlock()
		return result
	}
	d.mu.RUnlock()

	d.mu.Lock()
	defer d.mu.Unlock()

	// Double-check after acquiring write lock
	if d.available != nil {
		return *d.available
	}

	log := log.FromContext(ctx)
	available := d.checkCRDs(ctx)
	d.available = &available

	if available {
		log.Info("Gateway API Inference Extension CRDs detected, gateway integration enabled")
	} else {
		log.Info("Gateway API Inference Extension CRDs not found, gateway integration disabled")
	}

	return available
}

// Refresh clears the cached result so the next IsAvailable call re-checks
func (d *Detector) Refresh() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.available = nil
}

// checkCRDs verifies that both InferencePool and HTTPRoute CRDs exist
func (d *Detector) checkCRDs(ctx context.Context) bool {
	// Check InferencePool CRD
	if !d.checkCRD(ctx, InferencePoolCRDGroup, InferencePoolCRDVersion, InferencePoolCRDResource) {
		return false
	}

	// Check HTTPRoute CRD
	if !d.checkCRD(ctx, HTTPRouteCRDGroup, HTTPRouteCRDVersion, HTTPRouteCRDResource) {
		return false
	}

	return true
}

// checkCRD checks if a specific CRD exists via the discovery API
func (d *Detector) checkCRD(ctx context.Context, group, version, resource string) bool {
	log := log.FromContext(ctx)
	gv := group + "/" + version

	resources, err := d.discovery.ServerResourcesForGroupVersion(gv)
	if err != nil {
		if errors.IsNotFound(err) {
			log.V(1).Info("API group version not found", "groupVersion", gv)
			return false
		}
		// For other errors (network issues, etc.), assume not available
		log.V(1).Info("Error checking API group version", "groupVersion", gv, "error", err)
		return false
	}

	for _, r := range resources.APIResources {
		if r.Name == resource {
			return true
		}
	}

	log.V(1).Info("Resource not found in API group version", "resource", resource, "groupVersion", gv)
	return false
}

// HasExplicitGateway returns true if gateway name/namespace were explicitly configured
func (d *Detector) HasExplicitGateway() bool {
	return d.ExplicitGatewayName != "" && d.ExplicitGatewayNamespace != ""
}

// GetGatewayConfig returns the gateway configuration.
// Returns the explicit override if set, otherwise returns an error indicating
// that auto-detection should be performed by the reconciler.
func (d *Detector) GetGatewayConfig() (*GatewayConfig, error) {
	if d.HasExplicitGateway() {
		return &GatewayConfig{
			GatewayName:      d.ExplicitGatewayName,
			GatewayNamespace: d.ExplicitGatewayNamespace,
		}, nil
	}
	return nil, fmt.Errorf("no explicit gateway configured; reconciler should auto-detect")
}
