import { sharedManifestFields, hostPermissions } from './manifest.shared';

/**
 * MV3 manifest for FullShot — Firefox build.
 *
 * Differences from the Chrome manifest (src/manifest.config.ts), and why:
 * - `background.scripts` instead of `background.service_worker` — Firefox's MV3 implementation
 *   does not support the service_worker background type; it uses a persistent-ish "event page"
 *   loaded from a plain scripts array instead. scripts/build-firefox.mjs bundles the background
 *   as a single self-contained IIFE, so no ES-module background support is required either.
 * - `options_ui` instead of `options_page` — the key Firefox documents for MV3 (Chrome accepts
 *   either, but this repo keeps Chrome on `options_page` to match its own docs/convention).
 * - `browser_specific_settings.gecko` — required for permanent installs / signing via AMO.
 *   `id` is a placeholder; replace it with your own before submitting to addons.mozilla.org.
 *   `data_collection_permissions` is a (as of 2025) mandatory AMO field; FullShot transmits
 *   nothing off-device (see PRIVACY.md), so it declares "none".
 * - No `minimum_chrome_version`. `strict_min_version` (140) and `gecko_android.strict_min_version`
 *   (142) are set to whatever `gecko.data_collection_permissions` below requires on each platform
 *   (AMO-mandatory field; unsupported before those versions) — well past when OffscreenCanvas,
 *   MV3, and chrome.scripting itself stabilized, so nothing functional is lost by the floor.
 * - No remote-code / CRX-specific wrapper: this is a plain object written directly to
 *   dist-firefox/manifest.json by scripts/build-firefox.mjs (no @crxjs involved).
 */
export default {
  ...sharedManifestFields(),
  background: {
    scripts: ['background.js'],
  },
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: true,
  },
  host_permissions: hostPermissions(),
  browser_specific_settings: {
    gecko: {
      id: 'fullshot@example.com',
      strict_min_version: '140.0',
      data_collection_permissions: {
        required: ['none'],
      },
    },
    gecko_android: {
      strict_min_version: '142.0',
    },
  },
};
