import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The full-game simulation test needs room for 100+ seeded games.
    testTimeout: 300000,
  },
});