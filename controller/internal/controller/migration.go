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

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"
)

// MigrateLegacyProviderConfigs reads all InferenceProviderConfig resources using
// an unstructured client and rewrites any that still use the legacy flat engine
// format (engines: ["vllm"]) to the new per-engine capability format
// (engines: [{name: "vllm", gpuSupport: true, ...}]).
//
// This migration is idempotent: objects already in the new format are skipped.
// It must run before any typed Get/List calls to avoid deserialization failures
// during upgrades from the flat ProviderCapabilities schema.
func MigrateLegacyProviderConfigs(ctx context.Context, c client.Client) error {
	logger := log.FromContext(ctx).WithName("migration")

	gvk := schema.GroupVersionKind{
		Group:   "airunway.ai",
		Version: "v1alpha1",
		Kind:    "InferenceProviderConfig",
	}

	list := &unstructured.UnstructuredList{}
	list.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   gvk.Group,
		Version: gvk.Version,
		Kind:    gvk.Kind + "List",
	})

	if err := c.List(ctx, list); err != nil {
		// If the CRD doesn't exist yet, nothing to migrate.
		return nil
	}

	for _, item := range list.Items {
		name := item.GetName()

		capabilities, found, err := unstructured.NestedMap(item.Object, "spec", "capabilities")
		if err != nil || !found || capabilities == nil {
			continue
		}

		engines, found, err := unstructured.NestedSlice(capabilities, "engines")
		if err != nil || !found || len(engines) == 0 {
			continue
		}

		// Check if this is the legacy format (first element is a string, not an object)
		if _, isString := engines[0].(string); !isString {
			// Already in the new format (objects), skip
			continue
		}

		logger.Info("migrating legacy InferenceProviderConfig", "name", name)

		// Read the old flat fields
		oldServingModes, _, _ := unstructured.NestedStringSlice(capabilities, "servingModes")
		oldGPUSupport, _, _ := unstructured.NestedBool(capabilities, "gpuSupport")
		oldCPUSupport, _, _ := unstructured.NestedBool(capabilities, "cpuSupport")

		// Convert each string engine to the new EngineCapability format
		newEngines := make([]interface{}, 0, len(engines))
		for _, e := range engines {
			engineName, ok := e.(string)
			if !ok {
				continue
			}

			engineCap := map[string]interface{}{
				"name":       engineName,
				"gpuSupport": oldGPUSupport,
				"cpuSupport": oldCPUSupport,
			}
			if len(oldServingModes) > 0 {
				modes := make([]interface{}, len(oldServingModes))
				for i, m := range oldServingModes {
					modes[i] = m
				}
				engineCap["servingModes"] = modes
			}
			newEngines = append(newEngines, engineCap)
		}

		// Build the new capabilities map (only engines, no top-level flat fields)
		newCapabilities := map[string]interface{}{
			"engines": newEngines,
		}

		// Overwrite the capabilities field
		if err := unstructured.SetNestedField(item.Object, newCapabilities, "spec", "capabilities"); err != nil {
			return fmt.Errorf("failed to set migrated capabilities on %s: %w", name, err)
		}

		// Write back
		if err := c.Update(ctx, &item); err != nil {
			return fmt.Errorf("failed to update migrated InferenceProviderConfig %s: %w", name, err)
		}

		logger.Info("migrated InferenceProviderConfig to per-engine capabilities", "name", name)
	}

	return nil
}
