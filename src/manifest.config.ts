import { defineManifest } from '@crxjs/vite-plugin';
import { sharedManifestFields, hostPermissions } from './manifest.shared';

/**
 * MV3 manifest for FullShot — Chrome/Edge build.
 *
 * Design notes:
 * - The capture content script is injected on demand with chrome.scripting.executeScript,
 *   so it is NOT declared under `content_scripts`. This keeps the extension quiet until the
 *   user actually asks for a capture (activeTab model, no broad host permissions).
 * - The editor is a normal extension page opened in a tab after a capture completes.
 * - Fields shared with the Firefox build (src/manifest.firefox.ts) live in manifest.shared.ts.
 */
export default defineManifest({
  ...sharedManifestFields(),
  minimum_chrome_version: '102',
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  options_page: 'src/options/index.html',
  host_permissions: hostPermissions(),
});
