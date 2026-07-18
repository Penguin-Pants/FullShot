import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Builds the extension's HTML pages (popup, options, editor) for Firefox. These are ordinary
 * extension pages loaded in a tab/popup document, so — unlike the background script — ES modules
 * work fine here and this can reuse the same plain Vite pipeline Chrome uses for its pages.
 *
 * The background script and manifest.json are NOT produced by this config; they're built
 * separately by scripts/build-firefox.mjs, which also invokes this config for the pages above.
 */
export default defineConfig({
  define: {
    __FULLSHOT_TEST__: JSON.stringify(process.env.FULLSHOT_TEST === '1'),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: process.env.FIREFOX_OUT_DIR ?? 'dist-firefox',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        // Opened programmatically (chrome.tabs.create) rather than referenced from the manifest,
        // so — same as the Chrome config — it must be listed explicitly to be built.
        editor: resolve(__dirname, 'src/editor/index.html'),
      },
      // See vite.config.ts for why these are excluded: unused optional dependencies of jsPDF's
      // .html() plugin, which this extension never calls.
      external: ['html2canvas', 'dompurify'],
    },
  },
});
