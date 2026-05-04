package v1alpha1

import "fmt"

// ValidateImageFields verifies the legacy image override and the engine image
// override do not request different container images.
//
// spec.engine.image is the preferred field for new configurations, while
// spec.image remains supported as a legacy fallback. Setting both fields to the
// same value is allowed for backward compatibility during migration.
func (spec *ModelDeploymentSpec) ValidateImageFields() error {
	if spec.Image != "" && spec.Engine.Image != "" && spec.Image != spec.Engine.Image {
		return fmt.Errorf(
			"spec.image %q conflicts with spec.engine.image %q; remove spec.image or set both fields to the same value (spec.engine.image is preferred)",
			spec.Image,
			spec.Engine.Image,
		)
	}
	return nil
}

// ImageOverride returns the configured image override, preferring the engine
// image field over the legacy top-level image field.
func (spec *ModelDeploymentSpec) ImageOverride() string {
	if spec.Engine.Image != "" {
		return spec.Engine.Image
	}
	return spec.Image
}
