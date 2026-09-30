import { defineConfig, type Plugin } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'node:path';
import manifest from './src/manifest.config';

// jsPDF's output('pdfobjectnewwindow') opens a window that loads PDFObject from cdnjs.cloudflare.com.
// FullShot never calls it (exportPdf.ts calls output('blob')), but the Chrome Web Store review can
// reject a package that contains a remote script URL as remotely hosted code. Remove the URL from
// the bundle; scripts/package-chrome.mjs stops if a remote script URL is still in the build.
const PDFOBJECT_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdfobject/2.1.1/pdfobject.min.js';
const stripJsPdfCdnUrl: Plugin = {
  name: 'fullshot-strip-jspdf-cdn-url',
  enforce: 'pre',
  transform(code, id) {
    if (!id.includes('/node_modules/jspdf/') || !code.includes(PDFOBJECT_CDN)) return null;
    return { code: code.split(PDFOBJECT_CDN).join(''), map: null };
  },
};

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
  plugins: [stripJsPdfCdnUrl, crx({ manifest })],
  server: {
    port: 5173,
    strictPort: true,
  },
});
