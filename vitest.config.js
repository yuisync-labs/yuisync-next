import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // Bound jsdom concurrency just like workerd: CPU-based fanout can cause
    // synchronous routing/focus assertions to exceed 5 s on desktop runners.
    maxWorkers: 2,
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    clearMocks: true,
  },
})
