/**
 * Packages FullShot for addons.mozilla.org (AMO). Makes a production build in dist-firefox/, then
 * writes two files to web-ext-artifacts/:
 *
 *  - fullshot-<version>.zip         the add-on: upload it on AMO.
 *  - fullshot-<version>-source.zip  the source code of the last commit. AMO asks for it because the
 *                                   build bundles and minifies the code; its reviewers rebuild the
 *                                   add-on from it and compare (README.md, "Publishing on AMO").
 *
 * Run: npm run package:firefox   (typechecks first)
 */
import webExt from 'web-ext';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist-firefox');
const OUT = join(ROOT, 'web-ext-artifacts');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

// The source zip holds the last commit, so the working tree must match it: uncommitted changes or
// untracked files (the build also copies everything in public/) would make the add-on differ from
// what AMO's reviewers build from the source. Ignored files (node_modules, build output) don't count.
if (git('status', '--porcelain').trim()) {
  console.error('Commit your changes and remove untracked files first: the source zip is made from the last commit.');
  process.exit(1);
}

// Build here instead of packaging whatever dist-firefox/ holds, and without the two variables that
// make build-firefox.mjs write a test build (FULLSHOT_TEST) or write it elsewhere (FIREFOX_OUT_DIR),
// so a shell that still has them set cannot produce the package.
const env = { ...process.env };
delete env.FULLSHOT_TEST;
delete env.FIREFOX_OUT_DIR;
execFileSync(process.execPath, [join(ROOT, 'scripts/build-firefox.mjs')], { cwd: ROOT, env, stdio: 'inherit' });

// Production relies on activeTab alone; host permissions would mean a test build.
const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
if (manifest.host_permissions?.length) {
  console.error(`dist-firefox/manifest.json has host permissions (${manifest.host_permissions}); not packaging it.`);
  process.exit(1);
}

const { extensionPath } = await webExt.cmd.build(
  {
    sourceDir: DIST,
    artifactsDir: OUT,
    filename: `fullshot-${version}.zip`,
    overwriteDest: true,
  },
  { showReadyMessage: false },
);
const sourcePath = join(OUT, `fullshot-${version}-source.zip`);
git('archive', '--format=zip', '-o', sourcePath, 'HEAD');

console.log(`\nAMO upload files:\n  add-on:      ${extensionPath}\n  source code: ${sourcePath}`);
