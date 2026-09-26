# FullShot Privacy Policy

_Last updated: 2026-09-26_

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
- **Your captured images.** When you choose "Capture full page", the screenshot is stored in your
  browser's local storage (IndexedDB) so the editor can open it. Quick exports are saved straight
  to your Downloads folder and are not stored. FullShot keeps only the 10 most recent editor
  captures and deletes older ones automatically. Nothing leaves your device.
- **Your preferences.** Settings such as image quality and whether to stamp the page address on
  PDFs are saved locally with the browser's storage API.
- **Saving files.** When you export, the extension uses the browser's downloads feature to save the
  image or PDF to your Downloads folder. Nothing is uploaded.

## What the extension does NOT do

- It does **not** send your screenshots, page content, browsing history, URLs, or any other data to
  the developer or to any third party.
- It does **not** use analytics, tracking, or advertising.
- It does **not** load or run any code from a remote server.
- It does **not** require an account and collects no personal information.

## Data retention

Captures opened in the editor stay in local browser storage until 10 newer ones replace them, so
the editor can reload them. Quick exports are not stored. Preferences remain in local browser storage until you change them or remove the extension.
Uninstalling the extension removes its local data.

## Permissions

The extension requests only the permissions it needs for the above: `activeTab`, `scripting`,
`storage`, `unlimitedStorage`, and `downloads`. It requests no host permissions.

## Changes to this policy

If this policy changes, the "Last updated" date above will be revised.

## Contact

Developer: _[your name or organization]_
Email: _[your contact email]_
