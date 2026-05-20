/*
Copyright 2026.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
*/

package kaito

import (
	"context"
	"errors"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	storagev1 "k8s.io/api/storage/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// UpstreamHealth summarises the state of the real KAITO workspace controller.
// The probe is called from both the heartbeat loop (writing InferenceProviderConfig.status)
// and the ModelDeployment reconcile loop (refuse-fast when upstream is broken).
type UpstreamHealth struct {
	Healthy   bool
	Reason    string // one of the Reason* constants
	Message   string // user-facing, safe to surface in CR status
	ManagedBy string // "Helm", "Eno", or "" (unknown / no candidate resource)
}

// Reason codes stamped into InferenceProviderConfig.status.conditions[UpstreamReady]
// and into ModelDeployment.status.conditions[Ready] on the refuse-fast path.
const (
	ReasonUpstreamHealthy            = "UpstreamHealthy"
	ReasonCRDMissing                 = "CRDMissing"
	ReasonUpstreamControllerMissing  = "UpstreamControllerMissing"
	ReasonUpstreamControllerNotReady = "UpstreamControllerNotReady"
	ReasonEnoPartialInstall          = "EnoPartialInstall"
	ReasonProbeFailed                = "ProbeFailed"
	ReasonUnregistered               = "Unregistered" // stamped by MarkUnregistered on shim shutdown
)

// Well-known resource names the probe looks up.
const (
	kaitoStorageClassName         = "kaito-local-nvme-disk"
	kaitoDeploymentSelectorKey    = "app.kubernetes.io/name"
	kaitoDeploymentSelectorValue  = "workspace"
	managedByLabel                = "app.kubernetes.io/managed-by"
	managedByEno                  = "Eno"
	managedByHelm                 = "Helm"
	enoPartialInstallUserMessage  = "This cluster was set up with `--enable-ai-toolchain-operator`, which installs KAITO partially (CRDs and StorageClass only). The KAITO workspace controller is not running. Options: (1) disable the AKS extension with `az aks update --disable-ai-toolchain-operator ...` and then click Install KAITO, or (2) install the `kaito-workspace` controller manually."
	controllerMissingUserMessage  = "The KAITO workspace controller is not running. Install KAITO with `helm install kaito-workspace kaito/workspace`."
	controllerNotReadyUserMessage = "The KAITO workspace controller Deployment %s/%s exists but has no ready replicas."
	crdMissingUserMessage         = "KAITO Workspace CRD not found. Install KAITO."
)

// probeUpstreamController checks whether the upstream kaito-workspace controller
// is installed and running. The caller is responsible for applying a bounded
// timeout (e.g. context.WithTimeout(ctx, 10*time.Second)) and for passing an
// uncached direct client — NOT the manager's cached client. The function
// performs a handful of direct API calls per invocation and does not rely on
// informer caches.
//
// Probe order:
//  1. Detect CRD presence (via meta.NoKindMatchError on workspaces list)
//  2. Detect Eno signal (via the kaito-local-nvme-disk StorageClass label)
//  3. Find the controller Deployment by label
//  4. Any unexpected API error returns Reason=ProbeFailed
func probeUpstreamController(ctx context.Context, direct client.Client) UpstreamHealth {
	// Step 1: Detect CRD presence by checking the REST mapper.
	workspaceGVK := schema.GroupVersionKind{
		Group:   "kaito.sh",
		Version: "v1beta1",
		Kind:    "Workspace",
	}
	_, err := direct.RESTMapper().RESTMapping(workspaceGVK.GroupKind())
	if isNoKindMatch(err) {
		return UpstreamHealth{
			Healthy: false,
			Reason:  ReasonCRDMissing,
			Message: crdMissingUserMessage,
		}
	}
	if err != nil {
		return UpstreamHealth{
			Healthy: false,
			Reason:  ReasonProbeFailed,
			Message: fmt.Sprintf("check workspace crd: %v", err),
		}
	}

	// Step 2: Detect Eno signal from the well-known StorageClass.
	managedBy, err := getStorageClassManagedBy(ctx, direct)
	if err != nil {
		return UpstreamHealth{
			Healthy: false,
			Reason:  ReasonProbeFailed,
			Message: err.Error(),
		}
	}

	// Step 3: Find the controller Deployment by label.
	deploy, found, err := listWorkspaceController(ctx, direct)
	if err != nil {
		return UpstreamHealth{
			Healthy:   false,
			Reason:    ReasonProbeFailed,
			Message:   err.Error(),
			ManagedBy: managedBy,
		}
	}
	if !found {
		if managedBy == managedByEno {
			return UpstreamHealth{
				Healthy:   false,
				Reason:    ReasonEnoPartialInstall,
				Message:   enoPartialInstallUserMessage,
				ManagedBy: managedByEno,
			}
		}
		return UpstreamHealth{
			Healthy:   false,
			Reason:    ReasonUpstreamControllerMissing,
			Message:   controllerMissingUserMessage,
			ManagedBy: managedBy,
		}
	}

	// Step 4: Deployment found — healthy if ReadyReplicas > 0, otherwise NotReady.
	if deploy.Status.ReadyReplicas > 0 {
		return UpstreamHealth{
			Healthy:   true,
			Reason:    ReasonUpstreamHealthy,
			Message:   fmt.Sprintf("KAITO workspace controller %s/%s is ready", deploy.Namespace, deploy.Name),
			ManagedBy: managedBy,
		}
	}
	return UpstreamHealth{
		Healthy:   false,
		Reason:    ReasonUpstreamControllerNotReady,
		Message:   fmt.Sprintf(controllerNotReadyUserMessage, deploy.Namespace, deploy.Name),
		ManagedBy: managedBy,
	}
}

// isNoKindMatch returns true when err (possibly wrapped) indicates that the
// REST mapper has no mapping for the queried kind — i.e. the CRD is not
// installed in the cluster.
func isNoKindMatch(err error) bool {
	if err == nil {
		return false
	}
	var nkm *meta.NoKindMatchError
	return errors.As(err, &nkm)
}

// getStorageClassManagedBy reads the kaito-local-nvme-disk StorageClass and
// returns its app.kubernetes.io/managed-by label. Returns "" if the
// StorageClass does not exist; returns an error for any other failure.
func getStorageClassManagedBy(ctx context.Context, direct client.Client) (string, error) {
	sc := &storagev1.StorageClass{}
	err := direct.Get(ctx, types.NamespacedName{Name: kaitoStorageClassName}, sc)
	if apierrors.IsNotFound(err) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get storageclass %q: %w", kaitoStorageClassName, err)
	}
	if sc.Labels == nil {
		return "", nil
	}
	return sc.Labels[managedByLabel], nil
}

// listWorkspaceController returns the first Deployment matching the KAITO
// workspace controller label selector. It also returns a second return value
// indicating whether any Deployment with the selector was found (so callers
// can distinguish "missing" from "not ready").
func listWorkspaceController(ctx context.Context, direct client.Client) (*appsv1.Deployment, bool, error) {
	list := &appsv1.DeploymentList{}
	if err := direct.List(ctx, list, client.MatchingLabels{kaitoDeploymentSelectorKey: kaitoDeploymentSelectorValue}); err != nil {
		return nil, false, fmt.Errorf("list deployments: %w", err)
	}
	if len(list.Items) == 0 {
		return nil, false, nil
	}
	// Prefer a ready one; otherwise return the first item so the caller can
	// reference the namespace/name in the message.
	for i := range list.Items {
		d := &list.Items[i]
		if d.Status.ReadyReplicas > 0 {
			return d, true, nil
		}
	}
	return &list.Items[0], true, nil
}
