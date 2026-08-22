import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/client/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
