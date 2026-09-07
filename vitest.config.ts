import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false,
    env: { LOG_LEVEL: 'error', DATABASE_PATH: ':memory:' },
  },
});
