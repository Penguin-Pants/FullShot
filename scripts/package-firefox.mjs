/**
 * Packages the Firefox build for addons.mozilla.org (AMO). Writes two files to web-ext-artifacts/:
 *
 *  - fullshot-<version>.zip         the add-on: upload it on AMO.
 *  - fullshot-<version>-source.zip  the source code of the last commit. AMO asks for it because the
 *                                   build bundles and minifies the code; its reviewers rebuild the
 *                                   add-on from it and compare (README.md, "Publishing on AMO").
 *
 * Run: npm run package:firefox   (builds dist-firefox/ first)
 */
import webExt from 'web-ext';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = join(ROOT, 'web-ext-artifacts');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

// The source zip holds the last commit, so uncommitted changes to tracked files would make the
// add-on differ from what AMO's reviewers build from the source.
if (git('status', '--porcelain', '--untracked-files=no').trim()) {
  console.error('Commit your changes first: the source zip is made from the last commit.');
  process.exit(1);
}

const { extensionPath } = await webExt.cmd.build(
  {
    sourceDir: join(ROOT, 'dist-firefox'),
    artifactsDir: OUT,
    filename: `fullshot-${version}.zip`,
    overwriteDest: true,
  },
  { showReadyMessage: false },
);
const sourcePath = join(OUT, `fullshot-${version}-source.zip`);
git('archive', '--format=zip', '-o', sourcePath, 'HEAD');

console.log(`\nAMO upload files:\n  add-on:      ${extensionPath}\n  source code: ${sourcePath}`);
