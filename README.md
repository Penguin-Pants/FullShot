# FullShot — Full Page Screen Capture

Capture an **entire web page** (not just the visible part), the **visible area** or a **selected
area**, annotate it, and export as **PNG, JPEG, or PDF**. Everything runs locally in your browser.
No account, no upload, no watermark.

FullShot is a clean-room, MIT-licensed browser extension (Chrome/Edge and Firefox, Manifest V3).
It is an independent implementation and is not affiliated with, or derived from, any other
screenshot product.

One shared `src/` tree powers both browsers — the capture pipeline, editor, and exports are the
same code either way. Only the manifest and background-script packaging differ (see
[Firefox build](#firefox-build) below), because Firefox's MV3 background model isn't a service
worker.

## Features

- **Full-page capture** — scrolls the page in viewport steps, snapshots each with
  `chrome.tabs.captureVisibleTab`, and stitches the tiles into one image. Fixed/sticky headers are
  captured once (not repeated on every tile).
- **Visible-area capture** — what you see now, without the scrollbar (Alt+Shift+V).
- **Selected-area capture** — drag a rectangle on the page; Enter takes the visible area and Esc
  cancels (Alt+Shift+S).
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

## Firefox build

```bash
npm run build:firefox   # typecheck + production build into dist-firefox/
```

Then load it temporarily:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `dist-firefox/manifest.json`.

(Temporary add-ons are removed when Firefox closes — reload after each restart. `web-ext run`
does this automatically if you have Firefox installed locally: `npx web-ext run -s dist-firefox`.)

Validate the build with `npm run lint:firefox` (wraps Mozilla's `web-ext lint`, the same validator
AMO runs on upload).

## Publishing on AMO

Commit your changes, then run:

```bash
npm run package:firefox
```

It copies the files of the last commit to a temporary folder and builds the add-on there with the
same commands AMO reviewers use (`npm ci`, then `npm run build:firefox`). Then it writes two files
to `web-ext-artifacts/`:

- `fullshot-<version>.zip`: the add-on. Upload it on addons.mozilla.org.
- `fullshot-<version>-source.zip`: the source code of the last commit. Upload it when AMO asks for
  the source code. AMO requires it because the build bundles and minifies the code.

Because the build uses only committed files, the add-on always matches the source zip. The script
stops if the working tree has uncommitted changes or untracked files, so that nothing you expect
is left out. It always makes a production build, even when `FULLSHOT_TEST` or `FIREFOX_OUT_DIR`
is set in your shell.

For each new version, increase `version` in `package.json` (e.g. `npm version patch
--no-git-tag-version`). Keep the add-on ID (`browser_specific_settings.gecko.id` in
`src/manifest.firefox.ts`) unchanged: AMO identifies FullShot by it.

Paste-ready answers for the AMO form (summary, description, categories, license, notes for
reviewers) are in [`docs/amo-listing.md`](docs/amo-listing.md).

### Build instructions for AMO reviewers

- Operating system: Ubuntu 24.04 (Linux), the tested environment.
- Tools: Node.js 22.12 or newer (tested with 22.22.2) and npm 10 (tested with 10.9.7). Install both from
  <https://nodejs.org>.
- Commands, run in the folder that contains `package.json`:

  ```bash
  npm ci
  npm run build:firefox
  ```

- Result: `dist-firefox/`. Its files are identical to the files in the add-on zip.

## Usage

- Click the toolbar icon (or press **Alt+Shift+P**) → **Capture full page**. The stitched image
  opens in the editor.
- Choose **Visible** or **Area** at the top of the popup to capture only what you see, or a
  rectangle you drag on the page. The main button and the Quick export buttons use that choice.
  The popup always opens on **Full page**.
- Shortcuts: **Alt+Shift+V** captures the visible area and **Alt+Shift+S** starts an area
  selection; both open the editor. If a shortcut capture fails, the toolbar button shows a red
  **!** and its tooltip says why. You can change the keys in the browser's extension-shortcut
  settings.
- **Quick export** buttons in the popup save PNG, JPEG, or PDF straight to your downloads: the
  same capture as the main button, without opening the editor. You stay on the page, so you can
  export another format right away.
- FullShot captures the tab you opened it on. If that page reloads or navigates before you pick a
  format (or you click FullShot while it is still loading), the browser withdraws FullShot's access
  to it; FullShot then asks you to click its button again rather than failing with a browser error.
- In the editor, pick a tool, annotate, then export **PNG / JPEG / PDF** or **Copy** to the
  clipboard. Keyboard: `V` select, `C` crop, `R` redact, `A` arrow, `B` box, `E` ellipse, `T` text,
  `P` pen, `H` highlighter, `Ctrl/⌘+Z` undo, `Ctrl/⌘+Shift+Z` redo.

## Architecture

| Area | Files |
| --- | --- |
| MV3 manifest — shared fields | `src/manifest.shared.ts` |
| MV3 manifest — Chrome/Edge | `src/manifest.config.ts`, `vite.config.ts` (`@crxjs/vite-plugin`) → `dist/` |
| MV3 manifest — Firefox | `src/manifest.firefox.ts`, `vite.config.firefox.ts`, `scripts/build-firefox.mjs` → `dist-firefox/` |
| AMO packaging | `scripts/package-firefox.mjs` → `web-ext-artifacts/` (add-on zip and source zip) |
| Capture orchestration | `src/background/index.ts` (target-tab checks, one capture at a time, throttled `captureVisibleTab`, stage-tagged errors) |
| Page measurement / scroll / fixed-element hiding | `src/lib/pageScripts.ts` (injected via `executeScript({ func })`) |
| Tile stitching | `src/lib/stitch.ts` (OffscreenCanvas, DPR-aware, canvas-size guard) |
| Capture hand-off to editor | `src/lib/db.ts` (IndexedDB, holds multi-MB blobs) |
| Popup / options UI | `src/popup/*`, `src/options/*` |
| Annotation editor | `src/editor/*` (fabric.js v7, with v6's top-left object origin) |
| Exports | `src/lib/exportPdf.ts` (jsPDF, smart split; used by Quick PDF and the editor), `src/lib/exportImage.ts` (editor PNG/JPEG), `src/lib/download.ts` (object URL, or data: URL in Chrome's service worker) |

**Why Firefox needs a second build pipeline, not just a second manifest:** Firefox's MV3
`background` key doesn't support `service_worker` — it loads a plain `scripts` array as an event
page instead. `scripts/build-firefox.mjs` reuses the exact same `src/popup`, `src/options`, and
`src/editor` page bundles Chrome uses (ordinary extension pages, so ES modules are fine there), and
only handles the background script differently: esbuild bundles it into one dependency-free IIFE,
sidestepping any question of Firefox background ES-module support. `manifest.shared.ts` keeps every
field that's genuinely identical (permissions, icons, action, commands)
in one place so the two manifests can't silently drift apart.

**Capture flow:** the popup resolves the tab it was opened for (the tab the browser just granted
`activeTab` for) → the background confirms that tab is still showing and still accessible → injects
`prepAndMeasure` (hides scrollbars, measures via `document.scrollingElement`, records fixed/sticky
elements) → computes a scroll grid → for each step injects `scrollToStep` (instant scroll, hiding
fixed/sticky elements past the first row), throttles, checks the tab is still the one showing, and
calls `captureVisibleTab` → restores the page → `stitchTiles` composites everything on one
`OffscreenCanvas` (pixel scale taken from the captured tiles) → that canvas is encoded as PNG, JPEG,
or PDF and downloaded, or stored in IndexedDB for the editor tab.

**Visible and area captures** leave the page as it is (fixed and sticky elements show, as you see
them). Visible: inject `measureViewport` → one `captureVisibleTab` → `cropViewport` removes a
classic scrollbar (on the right, or on the left in Firefox with a right-to-left UI). Area: inject
`startAreaSelection`, a modal `<dialog>` in a closed shadow root, so it is above the page's own
dialogs, popovers and fullscreen elements. It takes the keyboard focus and gives it back, and the
page gets none of its pointer or key events. When the person finishes, the overlay removes itself,
waits two frames and sends `AREA_SELECTED` with the rectangle and viewport metrics; the background
then takes one `captureVisibleTab` and crops it. The two steps are separate messages, so nothing
waits in the background while the person selects. A full-page or visible capture that starts while
the overlay is open removes it first.

Failures name the stage that failed (preparing the page, capturing, saving, …) in the popup, and the
background logs a `[FullShot] capture failed` entry with the stage, tab id, page origin, page
and viewport dimensions, device pixel ratio, pixel scale, tile, and scroll position to the browser
console (no page content).

## Testing

Both browsers have an end-to-end harness that loads the built extension, captures a long fixture
page (fixed header, sticky nav, 8540 px tall), and checks the real output: stitched dimensions,
every section present, header captured once, no scrollbar painted into the tiles, PNG/JPEG/PDF
structure.

**Chrome** — drives Chromium via Playwright:

```bash
npm run test:e2e     # builds a test bundle and runs the harness under xvfb
```

The test bundle (`FULLSHOT_TEST=1`) adds a temporary `<all_urls>` host permission and a small test
hook so the harness can trigger a capture without a real toolbar click; both are compiled **out**
of the production build.

**Firefox** — drives a real Firefox (140+) through its built-in Marionette protocol, with no extra
dependencies. It tests the **production** build: no test hooks, no host permissions. The toolbar
button and the popup buttons are clicked with OS-level mouse events, so Firefox grants `activeTab`
exactly as it does for a person. It repeats every export several times and covers short, already
scrolled, quirks-mode, smooth-scrolling, zoomed, high-DPI and `resistFingerprinting` pages, reloads,
navigation, tab switches, overlapping requests, and restricted pages. It also uses every editor
tool with real pointer and key input and checks the exported pixels (each tool draws only where it
was used; Delete, Undo and crop work), and it checks a PDF with the address and date stamp:

```bash
FIREFOX_BIN=/path/to/firefox npm run test:e2e:firefox
# options: REPEAT=10 (repetitions), ONLY=quickPngRepeated,lifecycle (scenarios),
#          EDITOR_BASELINE=<output folder of an earlier run> (editor exports must match it exactly)
```

It needs a display for the OS-level events (`xvfb-run` is used by the npm script). Results are
written to `test/e2e/out/firefox/results.json`.

Firefox is also verified statically on every build:

```bash
npm run build:firefox   # typecheck + build
npm run lint:firefox    # Mozilla's own manifest/source validator (web-ext lint) — must be 0 errors
```

`lint:firefox` reports 0 errors and 2 warnings. Both are in jsPDF's main file, which sets
`innerHTML` only through `DOMPurify.sanitize` in its `.html()` plugin; FullShot never calls it.
The project's own code uses no `innerHTML`, `document.write` or `eval`. jsPDF's optional
dependencies (`html2canvas` and `dompurify` for `.html()`, `canvg` for SVG images) are never
invoked, since FullShot only adds its own JPEG and text and calls `pdf.output('blob')`. They are
excluded from the page bundles via `build.rollupOptions.external` in `vite.config.ts` and
`vite.config.firefox.ts`, and from the Firefox background bundle in `scripts/build-firefox.mjs`.
This keeps about 380KB of unused code, and the warnings it triggered, out of the build.

## License

MIT — see `LICENSE`.
