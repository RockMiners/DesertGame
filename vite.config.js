import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execSync } from 'node:child_process';

// shown in the F3 readout and on the title screen, so it's clear which version a page is running
let build = 'dev';
try { build = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* not a git checkout */ }
build += ' ' + new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig(({ mode }) => ({
  base: './',
  define: { __BUILD__: JSON.stringify(build) },
  build: {
    outDir: mode === 'single' ? 'dist-single' : mode === 'artifact' ? 'dist-artifact' : 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
  },
  plugins: mode === 'single' || mode === 'artifact' ? [viteSingleFile()] : [],
}));
