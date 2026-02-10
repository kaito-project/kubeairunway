# Coding Standards

## Code Quality

### General Principles
- **Readability First**: Self-documenting code with descriptive names
- **Single Responsibility**: One purpose per function/class/module
- **DRY**: Extract common logic into reusable utilities
- **Keep It Simple**: Simplest solution that meets requirements

### TypeScript
- No `any` types - use proper typing
- Use Zod for runtime validation (integrated with Hono via `@hono/zod-validator`)
- Import shared types from `@kubeairunway/shared` (do not duplicate type definitions)
- Use path aliases (`@/`) for imports in frontend

### React
- Functional components with hooks
- Custom hooks for API calls (`useModels`, `useDeployments`, etc.)
- TanStack Query for server state
- Component composition over inheritance

### File Organization

**Frontend:**
```
components/
  feature-name/
    FeatureComponent.tsx
    SubComponent.tsx
hooks/
  useFeature.ts
lib/
  api.ts        # API client
  utils.ts      # Utility functions
```

**Backend:**
```
src/
  hono-app.ts   # All routes consolidated
  index.ts      # Bun.serve() entry point
  providers/    # Inference runtime providers
  services/     # Business logic (Kubernetes, Helm, etc.)
  lib/          # Shared utilities
```

## Testing

### Requirements
- Unit tests for utility functions
- Integration tests for API endpoints
- Tests must be deterministic (no flaky tests)
- All tests must pass before merge

### Test Structure
```typescript
describe('ComponentName', () => {
  it('should do expected behavior', () => {
    // Arrange
    // Act
    // Assert
  });
});
```

## User Experience

### UI Standards
- Clear feedback for all actions (success, error, loading)
- User-friendly error messages
- Loading indicators for async operations
- Responsive design (desktop + tablet)

### Error Handling
- Never expose technical errors to users
- Provide remediation suggestions
- Graceful degradation when services unavailable

## Performance

### Response Times
- UI interactions: < 100ms
- Page loads: < 3 seconds
- API responses: < 500ms

### Best Practices
- Code-split appropriately
- Implement caching (React Query)
- Paginate large data sets
- Lazy load non-critical resources

## Security

- Validate all user input
- Sanitize before display
- No secrets in code/version control
- Keep dependencies updated

## Code Review

All changes require peer review:
- Clear, descriptive commit messages
- Constructive, actionable feedback
- Address technical debt incrementally
