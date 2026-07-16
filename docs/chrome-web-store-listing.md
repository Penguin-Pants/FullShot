# Chrome Web Store — Store listing fields (FullShot)

Paste-ready copy for the **Store listing** tab (separate from Privacy practices).

## Product name (max 75 chars)
> FullShot — Full Page Screen Capture

## Summary / short description (max 132 chars)
> Capture entire web pages in one click, annotate them, and save as PNG, JPEG, or PDF — 100% local, no account, no watermark.

## Category
- **Primary (recommended): Workflow & Planning**
- Good alternatives: **Developer Tools** or **Photos**

## Language
> English (add more locales later; the UI already ships `_locales`-ready strings in code form)

## Detailed description (max 16,000 chars)

> **Capture the whole page — not just what fits on screen.**
>
> FullShot takes a screenshot of an entire web page, top to bottom, in one click. Scroll-heavy
> articles, long threads, dashboards, receipts, full designs — capture all of it as a single
> image, then annotate and export it however you like.
>
> **Everything happens on your device.** No account, no sign-up, no watermark, and nothing is ever
> uploaded to a server. FullShot has no analytics and makes no network requests.
>
> **Features**
> • One-click full-page capture (or press Alt+Shift+P)
> • Quick export straight to PNG, JPEG, or PDF
> • Built-in editor to mark up your capture before saving:
>   – Crop
>   – Pixelate / redact (hide sensitive info)
>   – Arrows, boxes, ellipses
>   – Text labels
>   – Freehand pen and highlighter
>   – Undo / redo and zoom
> • Multi-page PDF export with smart page breaks that avoid slicing through text
> • Copy the finished image straight to your clipboard
>
> **Private by design**
> FullShot uses Chrome's "activeTab" model: it can only read the page you're on at the moment you
> click the button — it has no ongoing access to your browsing, and it requests no host
> permissions. Your captures, annotations, and settings stay in your browser's local storage.
>
> **Keyboard shortcuts (in the editor)**
> V select · C crop · R redact · A arrow · B box · E ellipse · T text · P pen · H highlighter ·
> Ctrl/⌘+Z undo · Ctrl/⌘+Shift+Z redo
>
> Open source (MIT). Feedback and issues welcome.

## Graphic assets checklist

| Asset | Spec | Status |
| --- | --- | --- |
| Store icon | 128×128 PNG | ✅ Ready — `public/icons/icon128.png` (bundled as the extension icon) |
| Screenshot(s) | 1280×800 or 640×400 PNG/JPEG, 1–5 | ✅ Generated — see `store-assets/` (editor + popup) |
| Small promo tile | 440×280 PNG | Optional — can generate on request |
| Marquee promo tile | 1400×560 PNG | Optional — can generate on request |

## Other listing fields
- **Official URL / homepage**: your repo or product page (optional).
- **Support URL**: e.g. the repo's Issues page (optional but recommended).
- **Mature content**: No.
- **Pricing**: Free.
