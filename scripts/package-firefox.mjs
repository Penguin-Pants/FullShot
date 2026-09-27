/**
 * Packages FullShot for addons.mozilla.org (AMO). Writes two files to web-ext-artifacts/:
 *
 *  - fullshot-<version>.zip         the add-on: upload it on AMO.
 *  - fullshot-<version>-source.zip  the source code of the last commit. AMO asks for it because the
 *                                   build bundles and minifies the code; its reviewers rebuild the
 *                                   add-on from it and compare (README.md, "Publishing on AMO").
 *
 * The add-on is built the way the reviewers build it: from a copy of exactly the files in the
 * source zip, with `npm ci` and `npm run build:firefox`. Nothing else in the working folder
 * (uncommitted, untracked or git-ignored files, a stale dist-firefox/) can reach the add-on.
 *
 * Run: npm run package:firefox
 */
import webExt from 'web-ext';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = join(ROOT, 'web-ext-artifacts');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

// Only the last commit is packaged, so stop rather than silently leave work in progress out.
if (git('status', '--porcelain').trim()) {
  console.error('Commit your changes and remove untracked files first: only the last commit is packaged.');
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'fullshot-amo-'));
try {
  // The files the source zip holds (git archive leaves out what .gitattributes marks export-ignore).
  git('archive', '--format=tar', '-o', join(work, 'source.tar'), 'HEAD');
  execFileSync('tar', ['-x', '-f', 'source.tar'], { cwd: work });
  rmSync(join(work, 'source.tar'));

  // The reviewers' commands, without the two variables that make build-firefox.mjs write a test
  // build (FULLSHOT_TEST) or write it elsewhere (FIREFOX_OUT_DIR).
  const env = { ...process.env };
  delete env.FULLSHOT_TEST;
  delete env.FIREFOX_OUT_DIR;
  execSync('npm ci --no-audit --no-fund', { cwd: work, env, stdio: 'inherit' });
  execSync('npm run build:firefox', { cwd: work, env, stdio: 'inherit' });

  // Production relies on activeTab alone; host permissions would mean a test build.
  const dist = join(work, 'dist-firefox');
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  if (manifest.host_permissions?.length) {
    throw new Error(`The build has host permissions (${manifest.host_permissions}); not packaging it.`);
  }

  const { extensionPath } = await webExt.cmd.build(
    {
      sourceDir: dist,
      artifactsDir: OUT,
      filename: `fullshot-${version}.zip`,
      overwriteDest: true,
    },
    { showReadyMessage: false },
  );
  const sourcePath = join(OUT, `fullshot-${version}-source.zip`);
  git('archive', '--format=zip', '-o', sourcePath, 'HEAD');

  console.log(`\nAMO upload files:\n  add-on:      ${extensionPath}\n  source code: ${sourcePath}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
