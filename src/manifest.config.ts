import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

/**
 * MV3 manifest for FullShot.
 *
 * Design notes:
 * - The capture content script is injected on demand with chrome.scripting.executeScript,
 *   so it is NOT declared under `content_scripts`. This keeps the extension quiet until the
 *   user actually asks for a capture (activeTab model, no broad host permissions).
 * - The editor is a normal extension page opened in a tab after a capture completes.
 */
export default defineManifest({
  manifest_version: 3,
  name: 'FullShot — Full Page Screenshot',
  version: pkg.version,
  description:
    'Capture an entire web page, annotate it, and export as PNG, JPEG, or PDF — all locally in your browser.',
  minimum_chrome_version: '102',
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
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  options_page: 'src/options/index.html',
  commands: {
    _execute_action: {
      suggested_key: { default: 'Alt+Shift+P' },
      description: 'Capture the full page',
    },
  },
  permissions: ['activeTab', 'scripting', 'storage', 'unlimitedStorage', 'downloads'],
  // Production uses the activeTab model (no standing host access). The E2E build sets FULLSHOT_TEST
  // so the harness can drive captureVisibleTab/executeScript without a real toolbar-click gesture.
  host_permissions: process.env.FULLSHOT_TEST === '1' ? ['<all_urls>'] : [],
  icons: {
    '16': 'icons/icon16.png',
    '32': 'icons/icon32.png',
    '48': 'icons/icon48.png',
    '128': 'icons/icon128.png',
  },
  web_accessible_resources: [
    {
      // The editor page reads the pending capture from session storage; no page assets are
      // exposed to sites. Editor/options are opened by the extension itself.
      resources: ['src/editor/index.html', 'assets/*'],
      matches: ['<all_urls>'],
    },
  ],
});
