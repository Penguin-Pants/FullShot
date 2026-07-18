/**
 * Builds the Firefox flavor of FullShot into dist-firefox/ (or $FIREFOX_OUT_DIR).
 *
 * Three steps:
 *  1) The HTML pages (popup/options/editor) via vite.config.firefox.ts — same page bundles as
 *     Chrome, since ES modules are fine in an ordinary extension page.
 *  2) The background script bundled as a single self-contained IIFE with esbuild. Firefox MV3
 *     backgrounds are `scripts: [...]`, not a service worker, so no ES-module background support
 *     is needed — bundling as an IIFE sidesteps that question entirely.
 *  3) manifest.json, generated from src/manifest.firefox.ts (bundled+imported on the fly so the
 *     TS source can be shared with the Chrome manifest without a separate transpile step).
 *
 * Run: node scripts/build-firefox.mjs   (or via `npm run build:firefox`)
 */
import { build as esbuildBuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = join(ROOT, process.env.FIREFOX_OUT_DIR ?? 'dist-firefox');
const isTest = process.env.FULLSHOT_TEST === '1';

async function buildPages() {
  await viteBuild({
    root: ROOT,
    configFile: join(ROOT, 'vite.config.firefox.ts'),
    build: { outDir: OUT, emptyOutDir: true },
  });
}

async function buildBackground() {
  await esbuildBuild({
    entryPoints: [join(ROOT, 'src/background/index.ts')],
    outfile: join(OUT, 'background.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    define: { __FULLSHOT_TEST__: JSON.stringify(isTest) },
    // Minify so `if (__FULLSHOT_TEST__)` folds to a constant and the dead branch (which contains
    // the test-only hook) is actually stripped from the production bundle, not just unreachable —
    // matching the Chrome/Rollup build, which tree-shakes it out entirely.
    minify: true,
    logLevel: 'info',
  });
}

async function writeManifest() {
  // Bundle the TS manifest module to an in-memory ESM chunk and import it directly, so the
  // Firefox manifest can share fields with the Chrome one (manifest.shared.ts) without a
  // separate hand-maintained copy.
  const result = await esbuildBuild({
    entryPoints: [join(ROOT, 'src/manifest.firefox.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  const { default: manifest } = await import(dataUrl);
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('wrote', join(OUT, 'manifest.json'));
}

await buildPages();
await buildBackground();
await writeManifest();
console.log(`\nFirefox build complete -> ${OUT}`);
