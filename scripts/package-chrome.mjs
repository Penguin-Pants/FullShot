/**
 * Packages FullShot for the Chrome Web Store. Writes one file to web-ext-artifacts/:
 *
 *  - fullshot-chrome-<version>.zip  the extension: upload it in the Chrome Web Store Developer
 *                                   Dashboard (a new item, or Package > Upload new package).
 *
 * The extension is built from a copy of exactly the files in the last commit, with `npm ci` and
 * `npm run build`, the same way scripts/package-firefox.mjs builds the AMO package. Nothing else
 * in the working folder (uncommitted, untracked or git-ignored files, a stale dist/) can reach the
 * zip. The Chrome Web Store does not ask for source code, so there is no source zip.
 *
 * Run: npm run package:chrome
 */
import webExt from 'web-ext';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
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

/** Every file below `dir`, as paths relative to it. */
function listFiles(dir, prefix = '') {
  return readdirSync(dir).flatMap((name) => {
    const rel = prefix ? `${prefix}/${name}` : name;
    return statSync(join(dir, name)).isDirectory() ? listFiles(join(dir, name), rel) : [rel];
  });
}

const work = mkdtempSync(join(tmpdir(), 'fullshot-cws-'));
try {
  git('archive', '--format=tar', '-o', join(work, 'source.tar'), 'HEAD');
  execFileSync('tar', ['-x', '-f', 'source.tar'], { cwd: work });
  rmSync(join(work, 'source.tar'));

  // FULLSHOT_TEST would add <all_urls> and the test hook. `--include=dev` keeps the build tools
  // when NODE_ENV=production or npm's `omit` setting would leave devDependencies out.
  const env = { ...process.env };
  delete env.FULLSHOT_TEST;
  execSync('npm ci --include=dev --no-audit --no-fund', { cwd: work, env, stdio: 'inherit' });
  execSync('npm run build', { cwd: work, env, stdio: 'inherit' });

  // Check the build before it can reach the store.
  const dist = join(work, 'dist');
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  if (manifest.host_permissions?.length) {
    throw new Error(`The build has host permissions (${manifest.host_permissions}); not packaging it.`);
  }
  if (manifest.version !== version) {
    throw new Error(`manifest.json has version ${manifest.version}, package.json has ${version}.`);
  }
  const files = listFiles(dist);
  for (const file of files) {
    if (file.endsWith('.map')) throw new Error(`The build has a source map (${file}); not packaging it.`);
    if (!/\.(js|html)$/.test(file)) continue;
    const text = readFileSync(join(dist, file), 'utf8');
    if (text.includes('__fullshotTest')) {
      throw new Error(`${file} has the test hook: this is a test build; not packaging it.`);
    }
    // The store review can reject a remote script URL as remotely hosted code (see vite.config.ts).
    const remoteScript = text.match(/https?:\/\/[^\s"'`]+\.m?js\b/);
    if (remoteScript) {
      throw new Error(`${file} has a remote script URL (${remoteScript[0]}); not packaging it.`);
    }
  }

  const { extensionPath } = await webExt.cmd.build(
    {
      sourceDir: dist,
      artifactsDir: OUT,
      filename: `fullshot-chrome-${version}.zip`,
      overwriteDest: true,
    },
    { showReadyMessage: false },
  );

  console.log(`\nChrome Web Store upload file (${files.length} files):\n  ${extensionPath}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
