import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    outDir: mode === 'single' ? 'dist-single' : mode === 'artifact' ? 'dist-artifact' : 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
  },
  plugins: mode === 'single' || mode === 'artifact' ? [viteSingleFile()] : [],
}));
