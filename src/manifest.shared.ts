import pkg from '../package.json';

/**
 * Manifest fields that are identical across every browser target. Chrome (manifest.config.ts)
 * and Firefox (manifest.firefox.ts) each spread this in and add only the fields where the two
 * platforms genuinely differ (background script type, options page key, host-permission
 * quirks) — see the comments in manifest.firefox.ts for what those are and why.
 */
export function sharedManifestFields() {
  return {
    manifest_version: 3 as const,
    name: 'FullShot — Full Page Screenshot',
    version: pkg.version,
    description:
      'Capture an entire web page, annotate it, and export as PNG, JPEG, or PDF — all locally in your browser.',
    action: {
      default_title: 'FullShot — capture full page',
      default_popup: 'src/popup/index.html',
      default_icon: {
        '16': 'icons/icon16.png',
        '32': 'icons/icon32.png',
        '48': 'icons/icon48.png',
        '128': 'icons/icon128.png',
      },
    },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+P' },
        description: 'Capture the full page',
      },
    },
    permissions: ['activeTab', 'scripting', 'storage', 'unlimitedStorage', 'downloads'],
    icons: {
      '16': 'icons/icon16.png',
      '32': 'icons/icon32.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    },
    web_accessible_resources: [
      {
        // The editor page reads the pending capture from IndexedDB; no page assets are exposed
        // to sites. Editor/options are opened by the extension itself.
        resources: ['src/editor/index.html', 'assets/*'],
        matches: ['<all_urls>'],
      },
    ],
  };
}

/**
 * Production uses the activeTab model (no standing host access) on both browsers. The E2E test
 * build sets FULLSHOT_TEST so the harness can drive captureVisibleTab/executeScript without a
 * real toolbar-click gesture.
 */
export function hostPermissions(): string[] {
  return process.env.FULLSHOT_TEST === '1' ? ['<all_urls>'] : [];
}
