import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Everything (JS + CSS) is inlined into dist/index.html so the app runs offline from a single file.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2020', outDir: 'dist' },
  test: { globals: true, include: ['src/**/*.test.ts'] },
});
