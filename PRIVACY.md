# FullShot Privacy Policy

_Last updated: 2026-09-30_

FullShot ("the extension") is a browser extension that captures screenshots of web pages (the full
page, the visible area or a selected area), lets you annotate them, and saves them as PNG, JPEG or
PDF files. This policy explains how it handles your data.

## The short version

**FullShot does not send, sell or share any of your data.** It has no servers, no analytics and no
third-party services. The data that FullShot handles stays on your own device.

## What the extension handles, and why

- **The content of the page you capture, only when you ask.** When you click the FullShot button
  (or press one of its shortcuts), the extension captures the pixels of the tab you are viewing to
  make the screenshot. It uses the `activeTab` model, so it has access only to that one tab, only
  after you start a capture. It never reads pages in the background and never reads other tabs.
- **The address and title of the page you capture.** FullShot uses the site name from the address
  in the file name and, if you turn on the option, prints the address and date on PDF pages. It
  stores the address and title with editor captures (see below).
- **Your captured images.** When you open a capture in the editor, FullShot stores the image in
  your browser's local storage (IndexedDB), with the page address, the page title and the capture
  time, so the editor can open it and reload it. FullShot keeps only the 10 newest editor captures
  and deletes older ones automatically. Quick exports go straight to your Downloads folder and are
  not stored.
- **Your preferences.** FullShot saves its two options (image quality, and whether to stamp the page
  address on PDFs) with the browser's storage API. If you turn on your browser's sync feature, your
  browser can copy these options to your other signed-in browsers. The developer never receives
  them.
- **Saving files.** When you export, the extension uses the browser's downloads feature to save the
  image or PDF to your Downloads folder, or copies the image to your clipboard when you click Copy.
  Nothing is uploaded.

## What the extension does NOT do

- It does **not** send your screenshots, page content, browsing history, URLs or any other data to
  the developer or to any third party.
- It does **not** use analytics, tracking or advertising.
- It does **not** load or run any code from a remote server.
- It does **not** require an account and does not ask for personal information.

## Chrome Web Store User Data Policy

The use of information received from Chrome APIs complies with the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/),
including the Limited Use requirements. FullShot uses page content and page addresses only to make,
edit and save the screenshots that you ask for.

## Data retention

Captures opened in the editor stay in local browser storage until 10 newer ones replace them.
Quick exports are not stored. Preferences stay in browser storage until you change them or remove
the extension. When you uninstall the extension, the browser deletes its local data. Files that you
saved to your Downloads folder stay there until you delete them.

## Permissions

The extension requests only the permissions it needs for the above: `activeTab`, `scripting`,
`storage`, `unlimitedStorage` and `downloads`. It requests no host permissions.

## Changes to this policy

If this policy changes, the "Last updated" date above will change too.

## Contact

Developer: Penguin Pants

Questions and requests: open an issue at
<https://github.com/Penguin-Pants/FullShot/issues>
