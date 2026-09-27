import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'node:path';
import manifest from './src/manifest.config';

export default defineConfig({
  define: {
    // Compiled to a literal so the test-only hook tree-shakes out of production builds.
    __FULLSHOT_TEST__: JSON.stringify(process.env.FULLSHOT_TEST === '1'),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    // Tall screenshots produce large data URLs; keep chunks reasonable and skip the warning noise.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        // The editor is opened programmatically, so it must be an explicit build input.
        editor: resolve(__dirname, 'src/editor/index.html'),
      },
      // jsPDF dynamically imports html2canvas/dompurify (optionalDependencies) purely to power its
      // .html() rendering method, and canvg for its SVG images; this extension uses neither
      // (exportPdf.ts only adds its own JPEG and text, then calls pdf.output('blob')).
      // Externalizing them drops unused code from the bundle and avoids shipping
      // innerHTML-sanitization and Function-constructor warnings for code paths that are
      // unreachable here.
      external: ['html2canvas', 'dompurify', 'canvg'],
    },
  },
  plugins: [crx({ manifest })],
  server: {
    port: 5173,
    strictPort: true,
  },
});
