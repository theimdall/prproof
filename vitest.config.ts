import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/adapters/**'],
      // Barrels re-export; the model files are types with no runtime behaviour.
      // Counting them measures nothing and hides the coverage that matters.
      exclude: ['**/index.ts', 'src/core/model/report.ts'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
