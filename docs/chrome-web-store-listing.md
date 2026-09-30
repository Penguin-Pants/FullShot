# Chrome Web Store: submission kit (FullShot)

Paste-ready answers for the Chrome Web Store Developer Dashboard, tab by tab. The privacy answers
are in [`chrome-web-store-privacy.md`](chrome-web-store-privacy.md). The images are in
[`chrome-web-store/`](chrome-web-store/).

Field names and limits follow the Chrome Web Store documentation ("Complete your listing
information", "Supplying Images", "Fill out the privacy fields" and "Best practices: choose your
extension's category well").

## 1. Before you start

- [ ] Register a Chrome Web Store developer account (one-time registration fee) and verify its
      contact email. The store requires 2-Step Verification on the Google account.
- [ ] In **Account**, set the publisher name (for example `Penguin Pants`) and answer the trader
      question for the EU Digital Services Act. That answer is a legal choice for you to make.
- [ ] Build the upload file (section 2).

## 2. Package

Commit your changes, then run:

```bash
npm run package:chrome
```

The script builds the extension from a clean copy of the last commit (`npm ci`, then
`npm run build`) and writes `web-ext-artifacts/fullshot-chrome-<version>.zip`. Upload that file
with **Add new item** (first version) or **Package > Upload new package** (later versions).

The script stops if:

- the working tree has uncommitted changes or untracked files
- the build has host permissions, the test hook or source maps (a test build)
- a script file contains a remote script URL (the review can reject that as remote code)
- the manifest version is not the `package.json` version

For each new version, increase `version` in `package.json` first. The store rejects a version
that is not higher than the published one.

## 3. Store listing tab

### Product details

The dashboard takes these two fields from the manifest (`src/manifest.shared.ts`). You cannot
edit them in the dashboard.

| Field | Value | Limit |
| --- | --- | --- |
| Name | `FullShot — Full Page Screenshot` | 31 of 75 characters |
| Summary | `Capture a full web page, the visible area or a selected area, annotate it, and export as PNG, JPEG or PDF, locally.` | 115 of 132 characters |

**Description** (plain text; the store does not show Markdown):

```text
FullShot saves a whole web page as one image, from top to bottom, with one click. Long articles, threads, dashboards, receipts and designs: capture all of it, mark it up and save it.

Everything happens in your browser. FullShot needs no account and adds no watermark. It sends nothing to any server and collects no data.

FEATURES
• Full-page capture with one click, or press Alt+Shift+P
• Visible-area capture (Alt+Shift+V)
• Selected-area capture: drag a rectangle on the page (Alt+Shift+S)
• Quick export: save the capture straight to PNG, JPEG or PDF
• An editor to mark up the capture before you save it:
  - crop
  - pixelate to hide private details
  - arrows, boxes and ellipses
  - text
  - pen and highlighter
  - undo, redo and zoom
• Multi-page PDF: page breaks go on rows with little content, so they rarely cut through text
• Optional address and date stamp on each PDF page (in the options)
• Copy the finished image to the clipboard
• A fixed or sticky header shows once, at the top of the capture

HOW TO USE
1. Open the page that you want to capture.
2. Click the FullShot button in the toolbar, or press Alt+Shift+P.
3. Choose Full page, Visible or Area at the top of the popup.
4. Click the main button to open the editor. Or click PNG, JPEG or PDF to save the file at once. For Area, drag a rectangle on the page first.

You can change the keyboard shortcuts at chrome://extensions/shortcuts.

PERMISSIONS
• Access to the current tab (activeTab): only for the tab where you click the FullShot button or press its shortcut, and only at that time. FullShot scrolls the page to capture it, then puts it back as it was.
• Scripting: to measure and scroll the page during a capture.
• Downloads: to save your PNG, JPEG or PDF file.
• Storage (including unlimited storage): to keep your options and to pass large captures to the editor. FullShot keeps only the 10 newest editor captures, on your computer.

FullShot asks for no access to your websites. It cannot read a page until you start a capture on it.

LIMITS
• Pages that scroll inside an inner panel (some web apps) are captured as one screen.
• Chrome does not let extensions capture its own pages (chrome://), the Chrome Web Store or other extensions' pages.
• If a page reloads after you open FullShot, click the FullShot button again.

FullShot is open source (MIT License): https://github.com/Penguin-Pants/FullShot
```

| Field | Value | Why |
| --- | --- | --- |
| Category | **Art & Design** | The store's definition of this category names "capturing screenshots". |
| Language | **English (United States)** | FullShot has no other locales. |

### Graphic assets

Upload these files from [`chrome-web-store/`](chrome-web-store/). All screenshots are full bleed
with square corners and no alpha channel.

| Field | File | Size | Required |
| --- | --- | --- | --- |
| Store icon | `store-icon-128.png` | 128x128 (96x96 artwork, 16 px transparent padding) | Yes |
| Screenshot 1 | `screenshot-1-capture.png` | 1280x800 | Yes (1 to 5) |
| Screenshot 2 | `screenshot-2-editor.png` | 1280x800 | |
| Screenshot 3 | `screenshot-3-full-page.png` | 1280x800 | |
| Screenshot 4 | `screenshot-4-area.png` | 1280x800 | |
| Screenshot 5 | `screenshot-5-private.png` | 1280x800 | |
| Small promo tile | `promo-small-440x280.png` | 440x280 | Yes |
| Marquee promo tile | `promo-marquee-1400x560.png` | 1400x560 | No |
| Promo video | none | YouTube URL | No |

What each screenshot shows:

1. **Capture the whole page in one click.** The FullShot popup open over a web page.
2. **Mark it up before you save.** The editor, with pixelated names, a highlight, a box, an arrow
   and a note.
3. **The whole page, not just the screen.** The visible area next to the complete stitched capture.
4. **Or drag to capture one area.** The area selection on the page, with its size label.
5. **Everything stays on your device.** The privacy points, the popup and the options page.

The product UI in each image is a real screenshot of the extension. The web page is a fictional
demo page (`test/fixtures/store-demo.html`), so no real site, brand or person appears. The
browser window around it is a neutral drawing, with no Google or Chrome branding.

To make the images again (for example after a UI change):

```bash
npm run store:assets   # builds dist-test, then writes the images to docs/chrome-web-store/
node scripts/gen-icons.mjs   # the store icon (and the toolbar icons)
```

### Additional fields

| Field | Value |
| --- | --- |
| Official URL | None. This field needs a site that you verified in Google Search Console. |
| Homepage URL | `https://github.com/Penguin-Pants/FullShot` |
| Support URL | `https://github.com/Penguin-Pants/FullShot/issues` |
| Mature content | Off |

## 4. Privacy tab

See [`chrome-web-store-privacy.md`](chrome-web-store-privacy.md).

## 5. Distribution tab

| Field | Value |
| --- | --- |
| Visibility | Public |
| Distribution (regions) | All regions |

Use **Unlisted** instead if you want to test the store version with a link before the public
release.

## 6. Test instructions tab

No login is needed. Paste this into **Additional instructions**:

```text
No account or login is needed. FullShot has no server.

1. Open any normal web page with some length (for example https://en.wikipedia.org/wiki/Web_page).
2. Click the FullShot toolbar button. Keep "Full page" and click "Capture full page". FullShot scrolls the page, then opens the editor in a new tab with the complete page.
3. In the editor, try Redact, Arrow and Text, then click PNG or PDF. The file goes to the Downloads folder.
4. Open the popup again, choose "Area", click "Select an area" and drag a rectangle on the page. The editor opens with that area.
5. Shortcuts: Alt+Shift+P (open the popup), Alt+Shift+V (visible area), Alt+Shift+S (select an area).

FullShot requests no host permissions. It uses activeTab, so it can only capture a tab after the user clicks its button or presses one of its shortcuts. Chrome does not allow captures of chrome:// pages or the Chrome Web Store.
```

## 7. Submit

- [ ] Every tab shows no errors.
- [ ] The privacy policy URL opens in a private window (the repository must stay public).
- [ ] Click **Submit for review**. Leave "Publish automatically after review" on, or turn it off
      to publish by hand.

Review can take from a few days to a few weeks for a new item.
