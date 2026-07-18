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
      // .html() rendering method, which this extension never calls (exportPdf.ts only ever uses
      // pdf.output('blob') on a canvas we already built). Externalizing them drops ~220KB of unused
      // code from the bundle and avoids shipping innerHTML-sanitization warnings for code paths
      // that are unreachable here.
      external: ['html2canvas', 'dompurify'],
    },
  },
  plugins: [crx({ manifest })],
  server: {
    port: 5173,
    strictPort: true,
  },
});
