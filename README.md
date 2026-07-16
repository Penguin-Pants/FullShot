# FullShot — Full Page Screen Capture

Capture an **entire web page** (not just the visible part), annotate it, and export as **PNG,
JPEG, or PDF** — everything runs locally in your browser. No account, no upload, no watermark.

FullShot is a clean-room, MIT-licensed browser extension (Chrome/Edge, Manifest V3). It is an
independent implementation and is not affiliated with, or derived from, any other screenshot
product.

## Features

- **Full-page capture** — scrolls the page in viewport steps, snapshots each with
  `chrome.tabs.captureVisibleTab`, and stitches the tiles into one image. Fixed/sticky headers are
  captured once (not repeated on every tile).
- **Annotation editor** (fabric.js) — crop, pixelate/redact, arrow, box, ellipse, text, freehand
  pen, and highlighter, with undo/redo and zoom.
- **Local export** — PNG, JPEG, and multi-page **PDF** (jsPDF) with "smart" page splitting that
  breaks pages at low-content rows instead of slicing through text.
- **Privacy by design** — uses the `activeTab` model (no standing access to your browsing); the
  content script is injected only when you trigger a capture. Nothing leaves the machine.

## Install (development)

```bash
npm install
npm run build          # typecheck + production build into dist/
```

Then load it unpacked:

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder.

`npm run dev` runs Vite with HMR for iterating on the popup/editor/options pages.

## Usage

- Click the toolbar icon (or press **Alt+Shift+P**) → **Capture full page**. The stitched image
  opens in the editor.
- **Quick export** buttons in the popup save PNG/JPEG directly, or open the editor pre-set to
  export a PDF.
- In the editor, pick a tool, annotate, then export **PNG / JPEG / PDF** or **Copy** to the
  clipboard. Keyboard: `V` select, `C` crop, `R` redact, `A` arrow, `B` box, `E` ellipse, `T` text,
  `P` pen, `H` highlighter, `Ctrl/⌘+Z` undo, `Ctrl/⌘+Shift+Z` redo.

## Architecture

| Area | Files |
| --- | --- |
| MV3 manifest (typed) | `src/manifest.config.ts`, `vite.config.ts` (`@crxjs/vite-plugin`) |
| Capture orchestration | `src/background/index.ts` (throttled `captureVisibleTab`, retry/backoff) |
| Page measurement / scroll / fixed-element hiding | `src/lib/pageScripts.ts` (injected via `executeScript({ func })`) |
| Tile stitching | `src/lib/stitch.ts` (OffscreenCanvas, DPR-aware, canvas-size guard) |
| Capture hand-off to editor | `src/lib/db.ts` (IndexedDB, holds multi-MB blobs) |
| Popup / options UI | `src/popup/*`, `src/options/*` |
| Annotation editor | `src/editor/*` (fabric.js v6) |
| Exports | `src/lib/exportImage.ts` (PNG/JPEG), `src/lib/exportPdf.ts` (jsPDF, smart split) |

**Capture flow:** popup → background injects `prepAndMeasure` → computes a scroll grid → for each
step injects `scrollToStep` (hiding fixed/sticky elements past the first row), throttles, and calls
`captureVisibleTab` → `stitchTiles` composites everything on an `OffscreenCanvas` → the blob is
stored in IndexedDB and the editor tab opens.

## Testing

An end-to-end harness loads the built extension in Chromium and drives a real capture + editor +
export on a long fixture page, asserting on real output (stitched height, fixed-header-appears-once,
PNG/PDF file signatures):

```bash
npm run test:e2e     # builds a test bundle and runs the harness under xvfb
```

The test bundle (`FULLSHOT_TEST=1`) adds a temporary `<all_urls>` host permission and small test
hooks so the harness can trigger a capture without a real toolbar click; both are compiled **out**
of the production build.

## License

MIT — see `LICENSE`.
