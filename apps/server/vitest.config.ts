import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    // Integration suites run serially: they bind ports and drive real games.
    pool: 'forks',
  },
});
