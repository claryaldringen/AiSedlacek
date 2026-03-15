import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globals: true, environment: 'node' },
  resolve: {
    alias: {
      '@': import.meta.dirname,
      '@ai-sedlacek/shared': `${import.meta.dirname}/../../packages/shared/src`,
    },
  },
});
