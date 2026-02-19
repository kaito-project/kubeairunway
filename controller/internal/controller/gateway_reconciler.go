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

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"

	kubeairunwayv1alpha1 "github.com/kaito-project/kubeairunway/controller/api/v1alpha1"
	"github.com/kaito-project/kubeairunway/controller/internal/gateway"
	inferencev1 "sigs.k8s.io/gateway-api-inference-extension/api/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// reconcileGateway creates or updates InferencePool and HTTPRoute resources
// for a ModelDeployment that has gateway integration enabled.
func (r *ModelDeploymentReconciler) reconcileGateway(ctx context.Context, md *kubeairunwayv1alpha1.ModelDeployment) error {
	logger := log.FromContext(ctx)

	// Skip if no gateway detector configured
	if r.GatewayDetector == nil {
		return nil
	}

	// Skip if gateway CRDs are not available
	if !r.GatewayDetector.IsAvailable(ctx) {
		return nil
	}

	// Skip if explicitly disabled
	if md.Spec.Gateway != nil && md.Spec.Gateway.Enabled != nil && !*md.Spec.Gateway.Enabled {
		logger.V(1).Info("Gateway integration explicitly disabled", "name", md.Name)
		return nil
	}

	// Resolve gateway configuration
	gwConfig, err := r.resolveGatewayConfig(ctx, md)
	if err != nil {
		logger.Info("No gateway found for routing, skipping gateway reconciliation", "reason", err.Error())
		r.setCondition(md, kubeairunwayv1alpha1.ConditionTypeGatewayReady, metav1.ConditionFalse, "NoGateway", err.Error())
		return nil
	}

	// Determine target port from endpoint status
	port := int32(8000) // sensible default
	if md.Status.Endpoint != nil && md.Status.Endpoint.Port > 0 {
		port = md.Status.Endpoint.Port
	}

	// Create or update InferencePool
	if err := r.reconcileInferencePool(ctx, md, port); err != nil {
		r.setCondition(md, kubeairunwayv1alpha1.ConditionTypeGatewayReady, metav1.ConditionFalse, "InferencePoolFailed", err.Error())
		return fmt.Errorf("reconciling InferencePool: %w", err)
	}

	// Create or update HTTPRoute
	if err := r.reconcileHTTPRoute(ctx, md, gwConfig); err != nil {
		r.setCondition(md, kubeairunwayv1alpha1.ConditionTypeGatewayReady, metav1.ConditionFalse, "HTTPRouteFailed", err.Error())
		return fmt.Errorf("reconciling HTTPRoute: %w", err)
	}

	// Update gateway status
	modelName := md.ResolvedGatewayModelName()
	endpoint := r.resolveGatewayEndpoint(ctx, gwConfig)
	md.Status.Gateway = &kubeairunwayv1alpha1.GatewayStatus{
		Endpoint:  endpoint,
		ModelName: modelName,
		Ready:     true,
	}
	r.setCondition(md, kubeairunwayv1alpha1.ConditionTypeGatewayReady, metav1.ConditionTrue, "GatewayConfigured", "InferencePool and HTTPRoute created")

	logger.Info("Gateway resources reconciled", "name", md.Name, "gateway", gwConfig.GatewayName, "model", modelName)
	return nil
}

// resolveGatewayConfig determines which Gateway to use as the HTTPRoute parent.
func (r *ModelDeploymentReconciler) resolveGatewayConfig(ctx context.Context, md *kubeairunwayv1alpha1.ModelDeployment) (*gateway.GatewayConfig, error) {
	// Try explicit configuration first
	if cfg, err := r.GatewayDetector.GetGatewayConfig(); err == nil {
		return cfg, nil
	}

	// Auto-detect: list Gateway resources in the cluster
	var gateways gatewayv1.GatewayList
	if err := r.List(ctx, &gateways); err != nil {
		return nil, fmt.Errorf("failed to list gateways: %w", err)
	}

	switch len(gateways.Items) {
	case 0:
		return nil, fmt.Errorf("no Gateway resources found in cluster")
	case 1:
		gw := &gateways.Items[0]
		return &gateway.GatewayConfig{
			GatewayName:      gw.Name,
			GatewayNamespace: gw.Namespace,
		}, nil
	default:
		// Multiple gateways: look for one with the inference-gateway label
		for i := range gateways.Items {
			gw := &gateways.Items[i]
			if gw.Labels != nil && gw.Labels[gateway.LabelInferenceGateway] == "true" {
				return &gateway.GatewayConfig{
					GatewayName:      gw.Name,
					GatewayNamespace: gw.Namespace,
				}, nil
			}
		}
		return nil, fmt.Errorf("multiple Gateways found but none labeled with %s=true", gateway.LabelInferenceGateway)
	}
}

// reconcileInferencePool creates or updates the InferencePool for a ModelDeployment.
func (r *ModelDeploymentReconciler) reconcileInferencePool(ctx context.Context, md *kubeairunwayv1alpha1.ModelDeployment, port int32) error {
	pool := &inferencev1.InferencePool{
		ObjectMeta: metav1.ObjectMeta{
			Name:      md.Name,
			Namespace: md.Namespace,
		},
	}

	eppName := r.GatewayDetector.EPPServiceName
	if eppName == "" {
		eppName = "kubeairunway-epp"
	}
	eppPort := r.GatewayDetector.EPPServicePort
	if eppPort == 0 {
		eppPort = 9002
	}

	result, err := ctrl.CreateOrUpdate(ctx, r.Client, pool, func() error {
		pool.Spec.Selector = inferencev1.LabelSelector{
			MatchLabels: map[inferencev1.LabelKey]inferencev1.LabelValue{
				inferencev1.LabelKey(kubeairunwayv1alpha1.LabelModelDeployment): inferencev1.LabelValue(md.Name),
			},
		}
		pool.Spec.TargetPorts = []inferencev1.Port{
			{Number: inferencev1.PortNumber(port)},
		}
		pool.Spec.EndpointPickerRef = inferencev1.EndpointPickerRef{
			Name: inferencev1.ObjectName(eppName),
			Port: &inferencev1.Port{Number: inferencev1.PortNumber(eppPort)},
		}
		return ctrl.SetControllerReference(md, pool, r.Scheme)
	})
	if err != nil {
		return fmt.Errorf("failed to create/update InferencePool: %w", err)
	}

	log.FromContext(ctx).V(1).Info("InferencePool reconciled", "name", pool.Name, "result", result)
	return nil
}

// reconcileHTTPRoute creates or updates the HTTPRoute for a ModelDeployment.
func (r *ModelDeploymentReconciler) reconcileHTTPRoute(ctx context.Context, md *kubeairunwayv1alpha1.ModelDeployment, gwConfig *gateway.GatewayConfig) error {
	route := &gatewayv1.HTTPRoute{
		ObjectMeta: metav1.ObjectMeta{
			Name:      md.Name,
			Namespace: md.Namespace,
		},
	}

	group := gatewayv1.Group("inference.networking.k8s.io")
	kind := gatewayv1.Kind("InferencePool")
	ns := gatewayv1.Namespace(gwConfig.GatewayNamespace)

	result, err := ctrl.CreateOrUpdate(ctx, r.Client, route, func() error {
		route.Spec = gatewayv1.HTTPRouteSpec{
			CommonRouteSpec: gatewayv1.CommonRouteSpec{
				ParentRefs: []gatewayv1.ParentReference{
					{
						Name:      gatewayv1.ObjectName(gwConfig.GatewayName),
						Namespace: &ns,
					},
				},
			},
			Rules: []gatewayv1.HTTPRouteRule{
				{
					BackendRefs: []gatewayv1.HTTPBackendRef{
						{
							BackendRef: gatewayv1.BackendRef{
								BackendObjectReference: gatewayv1.BackendObjectReference{
									Group: &group,
									Kind:  &kind,
									Name:  gatewayv1.ObjectName(md.Name),
								},
							},
						},
					},
				},
			},
		}
		return ctrl.SetControllerReference(md, route, r.Scheme)
	})
	if err != nil {
		return fmt.Errorf("failed to create/update HTTPRoute: %w", err)
	}

	log.FromContext(ctx).V(1).Info("HTTPRoute reconciled", "name", route.Name, "result", result)
	return nil
}

// resolveGatewayEndpoint reads the Gateway resource's status to find the actual endpoint address.
func (r *ModelDeploymentReconciler) resolveGatewayEndpoint(ctx context.Context, gwConfig *gateway.GatewayConfig) string {
	var gw gatewayv1.Gateway
	if err := r.Get(ctx, client.ObjectKey{Name: gwConfig.GatewayName, Namespace: gwConfig.GatewayNamespace}, &gw); err != nil {
		log.FromContext(ctx).V(1).Info("Could not read Gateway status for endpoint", "error", err)
		return ""
	}
	for _, addr := range gw.Status.Addresses {
		if addr.Value != "" {
			return addr.Value
		}
	}
	return ""
}

// cleanupGatewayResources removes gateway resources when gateway is disabled.
// Owner references handle deletion automatically when the ModelDeployment is deleted,
// but this handles the case where gateway is explicitly disabled on an existing deployment.
func (r *ModelDeploymentReconciler) cleanupGatewayResources(ctx context.Context, md *kubeairunwayv1alpha1.ModelDeployment) error {
	logger := log.FromContext(ctx)

	// Delete InferencePool if it exists
	pool := &inferencev1.InferencePool{
		ObjectMeta: metav1.ObjectMeta{
			Name:      md.Name,
			Namespace: md.Namespace,
		},
	}
	if err := r.Delete(ctx, pool); client.IgnoreNotFound(err) != nil {
		return fmt.Errorf("failed to delete InferencePool: %w", err)
	}

	// Delete HTTPRoute if it exists
	route := &gatewayv1.HTTPRoute{
		ObjectMeta: metav1.ObjectMeta{
			Name:      md.Name,
			Namespace: md.Namespace,
		},
	}
	if err := r.Delete(ctx, route); client.IgnoreNotFound(err) != nil {
		return fmt.Errorf("failed to delete HTTPRoute: %w", err)
	}

	md.Status.Gateway = nil
	logger.Info("Gateway resources cleaned up", "name", md.Name)
	return nil
}
