# Chrome Web Store — Privacy practices answers (FullShot)

Paste-ready answers for the **Privacy practices** tab of the Chrome Web Store Developer Dashboard.
Everything below reflects the shipped code: FullShot processes and stores data **only on the
user's device** and makes **no network requests** of any kind.

---

## Single purpose

> FullShot captures a screenshot of the entire current web page — including the parts below the
> fold — then lets the user annotate it and save it as a PNG, JPEG, or PDF file on their own
> device. Capturing, editing, and exporting full-page screenshots is the extension's only purpose.

## Permission justifications

**activeTab**
> Needed to read the rendered pixels of the page the user is currently viewing so it can be
> captured. Access is granted only for the tab that is active at the moment the user clicks the
> FullShot toolbar button or presses its keyboard shortcut, and only for that action. FullShot has
> no standing access to any website.

**scripting**
> Used to inject a small script into the active tab, on demand, that measures the page's full
> dimensions and scrolls it in steps so each section can be captured and stitched into one
> full-page image, then restores the page. The script runs only after the user starts a capture; it
> is not registered as a persistent content script.

**storage**
> Used to save the user's own preferences (default export format, image quality, and whether to
> open the editor after a capture) with chrome.storage. No browsing data is stored.

**unlimitedStorage**
> A full-page screenshot can be several megabytes. The captured image is held briefly in the
> browser's local IndexedDB to pass it from the background service worker to the editor tab.
> unlimitedStorage keeps large captures from hitting the default storage quota. The image stays on
> the user's device and is deleted after use; it is never uploaded.

**downloads**
> Used with chrome.downloads to save the finished screenshot or PDF to the user's Downloads folder
> when they choose to export. It is used for nothing else.

**Host permissions**
> None requested. FullShot uses activeTab (temporary, user-initiated access to the current tab)
> instead of broad host permissions, so it never has ongoing access to the sites you visit.

## Are you using remote code?

> **No.** All JavaScript and WebAssembly is packaged inside the extension. Nothing is loaded or
> executed from a remote server, and no code is built from remotely fetched strings. The scripts
> injected via chrome.scripting are functions defined inside the extension package.

## Data usage — data types collected

FullShot does not transmit any data off the user's device, so **no data-type checkboxes should be
selected**. For reference, here is how each Chrome category applies:

| Category | Collected? | Notes |
| --- | --- | --- |
| Personally identifiable information | No | Not accessed or transmitted. |
| Health information | No | — |
| Financial and payment information | No | — |
| Authentication information | No | — |
| Personal communications | No | — |
| Location | No | — |
| Web history | No | The extension does not read history, URLs, or navigation. |
| User activity | No | No clicks, keystrokes, or analytics are recorded. |
| Website content | No (processed locally only) | The screenshot *is* page content, but it is captured, edited, and saved entirely on the device and is never sent to the developer or any third party. Under Chrome's definition, "collect" means transmitting off the device — FullShot does not. |

## Data-use certifications (check all three)

- ☑ **I do not sell or transfer user data to third parties**, outside of the approved use cases.
- ☑ **I do not use or transfer user data for purposes unrelated to my item's single purpose.**
- ☑ **I do not use or transfer user data to determine creditworthiness or for lending purposes.**

All three are true: FullShot has no server, no analytics, and no third-party data sharing.

## Privacy policy URL

A privacy policy is required. Host `PRIVACY.md` (in this repo) at a public URL and paste it here.
Easiest options:
- **GitHub Pages** or the rendered file URL of `PRIVACY.md` in your repository, or
- a **GitHub Gist**, or your own website.

Before publishing, fill in the developer name and contact email placeholders in `PRIVACY.md`.
