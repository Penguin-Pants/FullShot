# FullShot Privacy Policy

_Last updated: 2026-07-16_

FullShot ("the extension") is a browser extension that captures full-page screenshots, lets you
annotate them, and saves them as PNG, JPEG, or PDF files. This policy explains how it handles your
data.

## The short version

**FullShot does not collect, transmit, sell, or share any of your data.** It has no servers, no
analytics, and no third-party services. Everything the extension does happens locally, on your own
device.

## What the extension accesses, and why

- **The current page's content, only when you ask.** When you click the FullShot button (or press
  its shortcut), the extension reads the rendered pixels of the tab you are viewing so it can
  produce a screenshot. It uses the `activeTab` model, so it has access only to that one tab, only
  at the moment you trigger a capture — never in the background and never to other sites.
- **Your captured images.** A finished screenshot is stored temporarily in your browser's local
  storage (IndexedDB) so it can be opened in the editor. It never leaves your device and is removed
  after use.
- **Your preferences.** Settings such as your default export format and image quality are saved
  locally with the browser's storage API.
- **Saving files.** When you export, the extension uses the browser's downloads feature to save the
  image or PDF to your Downloads folder. Nothing is uploaded.

## What the extension does NOT do

- It does **not** send your screenshots, page content, browsing history, URLs, or any other data to
  the developer or to any third party.
- It does **not** use analytics, tracking, or advertising.
- It does **not** load or run any code from a remote server.
- It does **not** require an account and collects no personal information.

## Data retention

Captured images are held in local browser storage only long enough to edit and export them.
Preferences remain in local browser storage until you change them or remove the extension.
Uninstalling the extension removes its local data.

## Permissions

The extension requests only the permissions it needs for the above: `activeTab`, `scripting`,
`storage`, `unlimitedStorage`, and `downloads`. It requests no host permissions.

## Changes to this policy

If this policy changes, the "Last updated" date above will be revised.

## Contact

Developer: _[your name or organization]_
Email: _[your contact email]_
