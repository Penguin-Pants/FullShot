# addons.mozilla.org (AMO): listing fields (FullShot)

Paste-ready answers for the Firefox add-on submission form. The category and license names match
the choices AMO offers (as defined in AMO's own source code, `mozilla/addons-server`). Build and
upload the files first: see "Publishing on AMO" in the README.

## Submission

- **Distribution:** On this site (a public listing).
- **Add-on ID:** `fullshot@drclaw.dev` (`src/manifest.firefox.ts`). AMO identifies the listing by
  this ID, and every version must keep it.
- **Compatibility:** Firefox. Leave Firefox for Android unchecked; FullShot is not tested there.
- **Source code:** Yes. Upload `fullshot-<version>-source.zip` from the same
  `npm run package:firefox` run as the add-on zip.

## Name

> FullShot — Full Page Screenshot

AMO takes the name from the manifest (`src/manifest.shared.ts`).

## Add-on URL

> fullshot

If AMO reports that it is taken, use `fullshot-screenshot`.

## Summary (175 characters)

```text
Capture a whole web page in one click, mark it up in the built-in editor and save it as PNG, JPEG or PDF. Everything stays in your browser: no account, no upload, no tracking.
```

## Description

```text
FullShot saves a whole web page as one image, from top to bottom, with one click. Long articles, threads, dashboards, receipts and designs: capture all of it, mark it up and save it.

Everything happens in your browser. FullShot needs no account and adds no watermark. It sends nothing to any server and collects no data.

FEATURES
• Full-page capture with one click, or press Alt+Shift+P
• Visible-area capture (Alt+Shift+V) and selected-area capture: drag a rectangle (Alt+Shift+S)
• Quick export: save the capture straight to PNG, JPEG or PDF
• An editor to mark up the capture before you save it:
  - crop
  - pixelate to hide private details
  - arrows, boxes and ellipses
  - text
  - pen and highlighter
  - undo, redo and zoom
• Multi-page PDF: page breaks go on rows with little content, so they rarely cut through text
• Optional address and date stamp on each PDF page (in the settings)
• Copy the finished image to the clipboard

HOW TO USE
1. Open the page that you want to capture.
2. Click the FullShot button in the toolbar, or press Alt+Shift+P.
3. Choose Full page, Visible or Area at the top of the popup.
4. Click the main button to open the editor. Or click PNG, JPEG or PDF to save the file at once. For Area, drag a rectangle on the page first.

PERMISSIONS
• Access to the current tab: only for the tab where you click the FullShot button, and only at that time. FullShot scrolls the page to capture it, then puts it back as it was.
• Downloads: to save your PNG, JPEG or PDF file.
• Storage (including unlimited storage): to keep your settings and to pass large captures to the editor. FullShot keeps only the 10 newest editor captures, on your computer.

LIMITS
• Pages that scroll inside an inner panel (some web apps) are captured as one screen.
• Firefox does not let add-ons capture its own pages, add-on store pages or the PDF viewer.
• If a page reloads after you open FullShot, click the FullShot button again.

FullShot is open source (MIT License): https://github.com/Penguin-Pants/FullShot
```

## Categories

- **Photos, Music & Videos**
- **Web Development**

AMO allows up to 3; these 2 are enough.

## Tags

None. AMO only accepts tags from a fixed list, and none of them fits a screenshot tool.

## License

**MIT License** (the same as `LICENSE`).

## Privacy policy

None needed. AMO asks for a privacy policy only when an add-on sends user data, and FullShot sends
none (the manifest declares `data_collection_permissions: none`). If you add one anyway, use
`PRIVACY.md` (the same policy as the Chrome Web Store listing).

## Support and homepage

- **Support website:** https://github.com/Penguin-Pants/FullShot/issues
- **Homepage:** https://github.com/Penguin-Pants/FullShot
- **Support email:** optional.

## Other questions

- **Is this add-on experimental?** No.
- **Does it require payment or non-free services, software or hardware?** No.
- **Release notes:** "First public release." for the first version; list the changes for later
  versions.

## Notes for reviewers

Replace `<version>` with the version you upload.

```text
Source code: fullshot-<version>-source.zip. Build instructions are in README.md, section "Build instructions for AMO reviewers". Use Node.js 22.12 or newer and npm 10. Run "npm ci", then "npm run build:firefox". The output in dist-firefox/ is identical to the uploaded add-on.

Permissions: activeTab and scripting let FullShot capture only the tab on which the user clicked its button. downloads saves the PNG, JPEG or PDF file. storage keeps the two user options. unlimitedStorage lets the editor receive large full-page captures through IndexedDB; FullShot keeps at most 10 captures. There are no host permissions, no remote code and no data collection.

Validator warnings: both come from the bundled jsPDF library. The same code is in the background script (for Quick PDF) and in the editor (for its PDF export). jsPDF sets innerHTML only through DOMPurify.sanitize, in its html() plugin, which FullShot never calls; DOMPurify is not bundled. FullShot's own code uses no innerHTML, document.write or eval.
```

## Expected validator result

0 errors and 2 warnings, both "Unsafe assignment to innerHTML": one in `background.js` and one in
`assets/editor-*.js`. Both are the jsPDF code explained in the notes above. Warnings do not block a
submission.

## Screenshots (optional)

- Popup: "Capture the full page, or export it straight to PNG, JPEG or PDF."
- Editor with annotations: "Mark up the capture: crop, pixelate, arrows, boxes, text and more."
