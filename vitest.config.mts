import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['dotenv/config'],
  },
  // The panel screens are rendered in tests/pantallas.render.test.tsx, so JSX has to
  // compile here. The app's own tsconfig leaves `jsx` as `preserve` because Next compiles
  // it; vitest needs a real runtime.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
