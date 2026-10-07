import { defineConfig } from 'vite';

// Builds into /fishfinder at the site root so GitHub Pages serves it at /fishfinder/.
export default defineConfig({
  base: './',
  build: {
    outDir: '../../fishfinder',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    reportCompressedSize: true,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
} as never);
