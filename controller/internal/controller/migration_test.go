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
	"errors"
	"fmt"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
	"sigs.k8s.io/controller-runtime/pkg/client/interceptor"
)

// newUnstructuredScheme returns a fresh runtime.Scheme. Using a dedicated scheme
// avoids "double registration" panics when the Ginkgo suite_test.go registers
// the typed InferenceProviderConfig into the global scheme in the same test binary.
func newUnstructuredScheme() *runtime.Scheme {
	return runtime.NewScheme()
}

func TestMigrateLegacyProviderConfigs_FlatToNested(t *testing.T) {
	// Create a legacy InferenceProviderConfig with flat engine strings
	legacy := &unstructured.Unstructured{}
	legacy.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "airunway.ai",
		Version: "v1alpha1",
		Kind:    "InferenceProviderConfig",
	})
	legacy.SetName("kaito")
	if err := unstructured.SetNestedField(legacy.Object, map[string]interface{}{
		"engines":      []interface{}{"vllm", "llamacpp"},
		"servingModes": []interface{}{"aggregated"},
		"gpuSupport":   true,
		"cpuSupport":   true,
	}, "spec", "capabilities"); err != nil {
		t.Fatalf("failed to set capabilities: %v", err)
	}

	c := fake.NewClientBuilder().WithScheme(newUnstructuredScheme()).WithObjects(legacy).Build()

	err := MigrateLegacyProviderConfigs(context.Background(), c)
	if err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	// Read back and verify
	result := &unstructured.Unstructured{}
	result.SetGroupVersionKind(legacy.GroupVersionKind())
	if err := c.Get(context.Background(), client_key("kaito"), result); err != nil {
		t.Fatalf("failed to get migrated object: %v", err)
	}

	engines, found, err := unstructured.NestedSlice(result.Object, "spec", "capabilities", "engines")
	if err != nil || !found {
		t.Fatalf("migrated object missing engines: err=%v found=%v", err, found)
	}
	if len(engines) != 2 {
		t.Fatalf("expected 2 engines, got %d", len(engines))
	}

	// Check first engine is an object with name field
	eng0, ok := engines[0].(map[string]interface{})
	if !ok {
		t.Fatalf("expected engine[0] to be a map, got %T", engines[0])
	}
	if eng0["name"] != "vllm" {
		t.Errorf("expected engine[0].name=vllm, got %v", eng0["name"])
	}
	if eng0["gpuSupport"] != true {
		t.Errorf("expected engine[0].gpuSupport=true, got %v", eng0["gpuSupport"])
	}

	eng1, ok := engines[1].(map[string]interface{})
	if !ok {
		t.Fatalf("expected engine[1] to be a map, got %T", engines[1])
	}
	if eng1["name"] != "llamacpp" {
		t.Errorf("expected engine[1].name=llamacpp, got %v", eng1["name"])
	}
	if eng1["cpuSupport"] != true {
		t.Errorf("expected engine[1].cpuSupport=true, got %v", eng1["cpuSupport"])
	}

	// Verify old top-level fields are gone
	caps, _, _ := unstructured.NestedMap(result.Object, "spec", "capabilities")
	if _, exists := caps["servingModes"]; exists {
		t.Error("expected top-level servingModes to be removed after migration")
	}
	if _, exists := caps["gpuSupport"]; exists {
		t.Error("expected top-level gpuSupport to be removed after migration")
	}
	if _, exists := caps["cpuSupport"]; exists {
		t.Error("expected top-level cpuSupport to be removed after migration")
	}
}

func TestMigrateLegacyProviderConfigs_AlreadyMigrated(t *testing.T) {
	// Create an InferenceProviderConfig already in the new format
	obj := &unstructured.Unstructured{}
	obj.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "airunway.ai",
		Version: "v1alpha1",
		Kind:    "InferenceProviderConfig",
	})
	obj.SetName("dynamo")
	if err := unstructured.SetNestedField(obj.Object, map[string]interface{}{
		"engines": []interface{}{
			map[string]interface{}{
				"name":         "vllm",
				"gpuSupport":   true,
				"servingModes": []interface{}{"aggregated", "disaggregated"},
			},
		},
	}, "spec", "capabilities"); err != nil {
		t.Fatalf("failed to set capabilities: %v", err)
	}

	c := fake.NewClientBuilder().WithScheme(newUnstructuredScheme()).WithObjects(obj).Build()

	err := MigrateLegacyProviderConfigs(context.Background(), c)
	if err != nil {
		t.Fatalf("migration failed on already-migrated object: %v", err)
	}

	// Read back — should be unchanged
	result := &unstructured.Unstructured{}
	result.SetGroupVersionKind(obj.GroupVersionKind())
	if err := c.Get(context.Background(), client_key("dynamo"), result); err != nil {
		t.Fatalf("failed to get object: %v", err)
	}

	engines, _, _ := unstructured.NestedSlice(result.Object, "spec", "capabilities", "engines")
	if len(engines) != 1 {
		t.Fatalf("expected 1 engine, got %d", len(engines))
	}
	eng0, ok := engines[0].(map[string]interface{})
	if !ok {
		t.Fatalf("expected engine to be a map, got %T", engines[0])
	}
	if eng0["name"] != "vllm" {
		t.Errorf("expected name=vllm, got %v", eng0["name"])
	}
}

func TestMigrateLegacyProviderConfigs_NoObjects(t *testing.T) {
	c := fake.NewClientBuilder().WithScheme(newUnstructuredScheme()).Build()

	err := MigrateLegacyProviderConfigs(context.Background(), c)
	if err != nil {
		t.Fatalf("migration should not fail with no objects: %v", err)
	}
}

// client_key is a helper to create a client.ObjectKey for cluster-scoped resources.
func client_key(name string) client.ObjectKey {
	return client.ObjectKey{Name: name}
}

// TestMigrateLegacyProviderConfigs_PropagatesListErrors verifies the fix for the
// review feedback on PR #214: List errors other than "CRD not installed" must be
// surfaced rather than silently swallowed.
func TestMigrateLegacyProviderConfigs_PropagatesListErrors(t *testing.T) {
	gvk := schema.GroupVersionKind{
		Group:   "airunway.ai",
		Version: "v1alpha1",
		Kind:    "InferenceProviderConfig",
	}

	cases := []struct {
		name      string
		listErr   error
		wantErr   bool
		errSubstr string
	}{
		{
			name:    "no-match error (CRD not registered) is swallowed",
			listErr: &meta.NoKindMatchError{GroupKind: gvk.GroupKind()},
			wantErr: false,
		},
		{
			name:    "NotFound error is swallowed",
			listErr: apierrors.NewNotFound(schema.GroupResource{Group: gvk.Group, Resource: "inferenceproviderconfigs"}, ""),
			wantErr: false,
		},
		{
			name:      "Forbidden error is propagated",
			listErr:   apierrors.NewForbidden(schema.GroupResource{Group: gvk.Group, Resource: "inferenceproviderconfigs"}, "", errors.New("no access")),
			wantErr:   true,
			errSubstr: "failed to list InferenceProviderConfig",
		},
		{
			name:      "ServerTimeout error is propagated",
			listErr:   apierrors.NewServerTimeout(schema.GroupResource{Group: gvk.Group, Resource: "inferenceproviderconfigs"}, "list", 1),
			wantErr:   true,
			errSubstr: "failed to list InferenceProviderConfig",
		},
		{
			name:      "generic error is propagated",
			listErr:   errors.New("kaboom"),
			wantErr:   true,
			errSubstr: "kaboom",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			base := fake.NewClientBuilder().WithScheme(newUnstructuredScheme()).Build()
			c := interceptor.NewClient(base, interceptor.Funcs{
				List: func(_ context.Context, _ client.WithWatch, _ client.ObjectList, _ ...client.ListOption) error {
					return tc.listErr
				},
			})

			err := MigrateLegacyProviderConfigs(context.Background(), c)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				if tc.errSubstr != "" && !containsString(err.Error(), tc.errSubstr) {
					t.Errorf("expected error to contain %q, got %q", tc.errSubstr, err.Error())
				}
			} else if err != nil {
				t.Fatalf("expected no error, got %v", err)
			}
		})
	}
}

// TestMigrateLegacyProviderConfigs_UpdateErrorPropagates ensures Update failures
// during migration are also surfaced rather than swallowed.
func TestMigrateLegacyProviderConfigs_UpdateErrorPropagates(t *testing.T) {
	legacy := &unstructured.Unstructured{}
	legacy.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "airunway.ai",
		Version: "v1alpha1",
		Kind:    "InferenceProviderConfig",
	})
	legacy.SetName("kaito")
	legacy.SetResourceVersion("1")
	if err := unstructured.SetNestedField(legacy.Object, map[string]interface{}{
		"engines": []interface{}{"vllm"},
	}, "spec", "capabilities"); err != nil {
		t.Fatalf("failed to set capabilities: %v", err)
	}

	base := fake.NewClientBuilder().WithScheme(newUnstructuredScheme()).Build()
	// We can't seed unstructured objects via WithObjects without scheme registration,
	// so simulate the list returning the legacy object via interceptor.
	c := interceptor.NewClient(base, interceptor.Funcs{
		List: func(_ context.Context, _ client.WithWatch, list client.ObjectList, _ ...client.ListOption) error {
			ul, ok := list.(*unstructured.UnstructuredList)
			if !ok {
				return fmt.Errorf("unexpected list type %T", list)
			}
			ul.Items = []unstructured.Unstructured{*legacy}
			return nil
		},
		Update: func(_ context.Context, _ client.WithWatch, _ client.Object, _ ...client.UpdateOption) error {
			return apierrors.NewConflict(schema.GroupResource{Group: "airunway.ai", Resource: "inferenceproviderconfigs"}, "kaito", errors.New("conflict"))
		},
	})

	err := MigrateLegacyProviderConfigs(context.Background(), c)
	if err == nil {
		t.Fatalf("expected update conflict to propagate, got nil")
	}
	if !containsString(err.Error(), "failed to update migrated InferenceProviderConfig kaito") {
		t.Errorf("expected wrapped update error, got %q", err.Error())
	}
}

func containsString(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && (s == sub || indexOf(s, sub) >= 0))
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
