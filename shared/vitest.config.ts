/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['api/**/*.{test,spec}.ts', 'types/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
