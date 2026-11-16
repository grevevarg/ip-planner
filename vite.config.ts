import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site from https://<user>.github.io/<repo>/, so every
// asset URL must be prefixed with the repo name. Override with BASE_PATH when
// the repo is renamed or the site is served from a custom domain.
const base = process.env.BASE_PATH ?? '/ip-planner/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 9000, // the D2 WASM bundle is ~8 MB and lazy-loaded
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    coverage: {
      // The IP maths must stay fully covered; the rest of the app is not gated.
      include: ['src/ip/**'],
      exclude: ['src/ip/**/*.test.ts'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
