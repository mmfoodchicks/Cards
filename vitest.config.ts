import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // Migration and scan logging drowns out test output.
    env: { LOG_LEVEL: 'error', DATABASE_PATH: ':memory:' },
  },
});
