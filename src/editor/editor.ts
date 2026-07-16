/**
 * Annotation editor. Loads a stitched capture from IndexedDB, presents it on a fabric.js canvas,
 * and offers crop, pixelate/redact, arrow, box, ellipse, text, pen and highlighter tools with
 * undo/redo, then exports to PNG / JPEG / PDF (all locally).
 */
import * as fabric from 'fabric';
import { getCapture } from '@/lib/db';
import { loadOptions } from '@/lib/options';
import { downloadCanvas, copyCanvas } from '@/lib/exportImage';
import { exportCanvasToPdf } from '@/lib/exportPdf';

/** Build-time flag (see vite.config.ts); only the E2E build sets it, production strips the branch. */
declare const __FULLSHOT_TEST__: boolean;

type Tool = 'select' | 'crop' | 'redact' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'pen' | 'highlight';

interface Rect { x: number; y: number; w: number; h: number }

const params = new URLSearchParams(location.search);
const captureId = params.get('id') ?? '';
const autoAction = params.get('auto');

const canvasEl = document.getElementById('c') as HTMLCanvasElement;
const stage = document.getElementById('stage') as HTMLDivElement;
const loadingEl = document.getElementById('loading') as HTMLDivElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;
const colorInput = document.getElementById('color') as HTMLInputElement;
const widthInput = document.getElementById('width') as HTMLInputElement;
const resetCropBtn = document.getElementById('reset-crop') as HTMLButtonElement;
const undoBtn = document.getElementById('undo') as HTMLButtonElement;
const redoBtn = document.getElementById('redo') as HTMLButtonElement;

const canvas = new fabric.Canvas(canvasEl, {
  preserveObjectStacking: true,
  backgroundColor: '#ffffff',
  selection: true,
});

let natW = 0;
let natH = 0;
let zoom = 1;
let tool: Tool = 'select';
let color = colorInput.value;
let strokeWidth = Number(widthInput.value);
let bgSource: CanvasImageSource = canvasEl; // replaced with the real capture on load
let cropRect: Rect | null = null;
let meta = { pageUrl: '', capturedAt: Date.now() };
let quality = 0.92;

// The 4 dark bands that preview a crop (kept out of history and exports).
const mask: fabric.Rect[] = [];

/* ------------------------------ zoom ------------------------------ */

function applyZoom(z: number): void {
  zoom = z;
  canvas.setZoom(z);
  canvas.setDimensions({ width: Math.round(natW * z), height: Math.round(natH * z) });
}

function fitZoom(): void {
  const avail = stage.clientWidth - 48;
  applyZoom(Math.max(0.1, Math.min(1, avail / natW)));
}

/* ------------------------------ toast ------------------------------ */

let toastTimer: number | undefined;
function toast(msg: string, error = false): void {
  toastEl.hidden = false;
  toastEl.textContent = msg;
  toastEl.classList.toggle('toast--error', error);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 2600);
}

/* ------------------------------ history ------------------------------ */

const HISTORY_LIMIT = 30;
let history: string[] = [];
let historyIdx = -1;
let restoring = false;

function isMask(o: fabric.FabricObject): boolean {
  return (mask as fabric.FabricObject[]).includes(o);
}

function serialize(): string {
  const objs = canvas.getObjects().filter((o) => !isMask(o));
  return JSON.stringify(objs.map((o) => o.toObject()));
}

function pushHistory(): void {
  if (restoring) return;
  history = history.slice(0, historyIdx + 1);
  history.push(serialize());
  if (history.length > HISTORY_LIMIT) history.shift();
  historyIdx = history.length - 1;
  updateHistoryButtons();
}

async function restore(json: string): Promise<void> {
  restoring = true;
  canvas.getObjects().filter((o) => !isMask(o)).forEach((o) => canvas.remove(o));
  const objs = (await fabric.util.enlivenObjects(JSON.parse(json))) as fabric.FabricObject[];
  for (const o of objs) {
    if (o instanceof fabric.FabricImage && o.filters?.length) o.applyFilters();
    o.selectable = tool === 'select';
    o.evented = tool === 'select';
    canvas.add(o);
  }
  raiseMask();
  canvas.requestRenderAll();
  restoring = false;
  updateHistoryButtons();
}

function updateHistoryButtons(): void {
  undoBtn.disabled = historyIdx <= 0;
  redoBtn.disabled = historyIdx >= history.length - 1;
}

async function undo(): Promise<void> {
  if (historyIdx <= 0) return;
  historyIdx--;
  await restore(history[historyIdx]);
}
async function redo(): Promise<void> {
  if (historyIdx >= history.length - 1) return;
  historyIdx++;
  await restore(history[historyIdx]);
}

/* ------------------------------ crop mask ------------------------------ */

function raiseMask(): void {
  mask.forEach((m) => canvas.bringObjectToFront(m));
}

function updateMask(): void {
  const show = !!cropRect;
  resetCropBtn.hidden = !show;
  if (!show) {
    mask.forEach((m) => (m.visible = false));
    canvas.requestRenderAll();
    return;
  }
  const { x, y, w, h } = cropRect!;
  const geos: Rect[] = [
    { x: 0, y: 0, w: natW, h: y }, // top
    { x: 0, y: y + h, w: natW, h: natH - (y + h) }, // bottom
    { x: 0, y, w: x, h }, // left
    { x: x + w, y, w: natW - (x + w), h }, // right
  ];
  geos.forEach((g, i) => {
    mask[i].set({ left: g.x, top: g.y, width: Math.max(0, g.w), height: Math.max(0, g.h), visible: true });
    mask[i].setCoords();
  });
  raiseMask();
  canvas.requestRenderAll();
}

/* ------------------------------ tools ------------------------------ */

function setTool(next: Tool): void {
  tool = next;
  document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.tool === next)),
  );
  const isSelect = next === 'select';
  canvas.selection = isSelect;
  canvas.isDrawingMode = next === 'pen' || next === 'highlight';
  if (canvas.isDrawingMode) configureBrush();
  canvas.getObjects().filter((o) => !isMask(o)).forEach((o) => {
    o.selectable = isSelect;
    o.evented = isSelect;
  });
  if (!isSelect) canvas.discardActiveObject();
  canvas.defaultCursor = isSelect ? 'default' : 'crosshair';
  canvas.requestRenderAll();
}

function configureBrush(): void {
  const brush = new fabric.PencilBrush(canvas);
  if (tool === 'highlight') {
    brush.color = hexToRgba(color, 0.35);
    brush.width = Math.max(12, strokeWidth * 4);
  } else {
    brush.color = color;
    brush.width = strokeWidth;
  }
  canvas.freeDrawingBrush = brush;
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/* --- interactive shape drawing (rect / ellipse / arrow / redact / crop) --- */

let drawing = false;
let start = { x: 0, y: 0 };
let temp: fabric.FabricObject | null = null;

function clampPoint(p: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.min(Math.max(p.x, 0), natW), y: Math.min(Math.max(p.y, 0), natH) };
}

canvas.on('mouse:down', (opt) => {
  if (tool === 'select' || canvas.isDrawingMode) return;
  const p = clampPoint(canvas.getScenePoint(opt.e));

  if (tool === 'text') {
    addText(p.x, p.y);
    return;
  }

  drawing = true;
  start = p;
  const common = { left: p.x, top: p.y, selectable: false, evented: false, strokeUniform: true } as const;

  if (tool === 'rect') {
    temp = new fabric.Rect({ ...common, width: 0, height: 0, fill: 'rgba(0,0,0,0)', stroke: color, strokeWidth });
  } else if (tool === 'ellipse') {
    temp = new fabric.Ellipse({ ...common, rx: 0, ry: 0, fill: 'rgba(0,0,0,0)', stroke: color, strokeWidth });
  } else if (tool === 'arrow') {
    temp = new fabric.Line([p.x, p.y, p.x, p.y], { ...common, stroke: color, strokeWidth, strokeLineCap: 'round' });
  } else if (tool === 'redact') {
    temp = new fabric.Rect({ ...common, width: 0, height: 0, fill: 'rgba(15,23,42,0.45)', stroke: '#0ea5e9', strokeDashArray: [6, 4], strokeWidth: 1 });
  } else if (tool === 'crop') {
    temp = new fabric.Rect({ ...common, width: 0, height: 0, fill: 'rgba(14,165,233,0.12)', stroke: '#38bdf8', strokeDashArray: [6, 4], strokeWidth: 1 });
  }
  if (temp) canvas.add(temp);
});

canvas.on('mouse:move', (opt) => {
  if (!drawing || !temp) return;
  const p = clampPoint(canvas.getScenePoint(opt.e));
  const left = Math.min(start.x, p.x);
  const top = Math.min(start.y, p.y);
  const w = Math.abs(p.x - start.x);
  const h = Math.abs(p.y - start.y);

  if (temp instanceof fabric.Line) {
    temp.set({ x2: p.x, y2: p.y });
  } else if (temp instanceof fabric.Ellipse) {
    temp.set({ left, top, rx: w / 2, ry: h / 2 });
  } else if (temp instanceof fabric.Rect) {
    temp.set({ left, top, width: w, height: h });
  }
  temp.setCoords();
  canvas.requestRenderAll();
});

canvas.on('mouse:up', () => {
  if (!drawing || !temp) {
    drawing = false;
    return;
  }
  drawing = false;
  const obj = temp;
  temp = null;

  const tooSmall =
    obj instanceof fabric.Line
      ? Math.hypot((obj.x2 ?? 0) - (obj.x1 ?? 0), (obj.y2 ?? 0) - (obj.y1 ?? 0)) < 5
      : (obj.width ?? 0) < 4 && (obj.height ?? 0) < 4;

  if (tooSmall) {
    canvas.remove(obj);
    canvas.requestRenderAll();
    return;
  }

  if (tool === 'arrow' && obj instanceof fabric.Line) {
    canvas.remove(obj);
    canvas.add(buildArrow(obj.x1 ?? 0, obj.y1 ?? 0, obj.x2 ?? 0, obj.y2 ?? 0));
    raiseMask();
    pushHistory();
  } else if (tool === 'redact' && obj instanceof fabric.Rect) {
    canvas.remove(obj);
    const patch = buildRedaction(obj.left ?? 0, obj.top ?? 0, obj.width ?? 0, obj.height ?? 0);
    if (patch) {
      canvas.add(patch);
      raiseMask();
      pushHistory();
    }
  } else if (tool === 'crop' && obj instanceof fabric.Rect) {
    canvas.remove(obj);
    cropRect = { x: obj.left ?? 0, y: obj.top ?? 0, w: obj.width ?? 0, h: obj.height ?? 0 };
    updateMask();
    setTool('select');
  } else {
    raiseMask();
    pushHistory();
  }
  canvas.requestRenderAll();
});

function buildArrow(x1: number, y1: number, x2: number, y2: number): fabric.Group {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(12, strokeWidth * 3.5);
  const line = new fabric.Line([x1, y1, x2, y2], { stroke: color, strokeWidth, strokeLineCap: 'round' });
  const tri = new fabric.Triangle({
    left: x2,
    top: y2,
    originX: 'center',
    originY: 'center',
    width: head,
    height: head,
    fill: color,
    angle: (angle * 180) / Math.PI + 90,
  });
  return new fabric.Group([line, tri], { selectable: tool === 'select', evented: tool === 'select' });
}

function buildRedaction(x: number, y: number, w: number, h: number): fabric.FabricImage | null {
  const iw = Math.round(Math.min(w, natW - x));
  const ih = Math.round(Math.min(h, natH - y));
  if (iw < 3 || ih < 3) return null;
  const off = document.createElement('canvas');
  off.width = iw;
  off.height = ih;
  off.getContext('2d')!.drawImage(bgSource, x, y, iw, ih, 0, 0, iw, ih);
  const img = new fabric.FabricImage(off, { left: x, top: y, selectable: tool === 'select', evented: tool === 'select' });
  const blocksize = Math.min(40, Math.max(6, Math.round(Math.min(iw, ih) / 9)));
  img.filters = [new fabric.filters.Pixelate({ blocksize })];
  img.applyFilters();
  return img;
}

function addText(x: number, y: number): void {
  const tb = new fabric.Textbox('', {
    left: x,
    top: y,
    fill: color,
    fontSize: Math.max(16, strokeWidth * 5),
    fontFamily: 'Arial, sans-serif',
    width: 220,
  });
  canvas.add(tb);
  raiseMask();
  setTool('select');
  canvas.setActiveObject(tb);
  tb.enterEditing();
  tb.on('editing:exited', () => {
    if (!tb.text?.trim()) {
      canvas.remove(tb);
      canvas.requestRenderAll();
    } else {
      pushHistory();
    }
  });
}

/* ------------------------------ exports ------------------------------ */

function flatten(): HTMLCanvasElement {
  const wasVisible = mask.map((m) => m.visible);
  mask.forEach((m) => (m.visible = false));
  const prev = zoom;
  applyZoom(1);
  const full = canvas.toCanvasElement(1);
  applyZoom(prev);
  mask.forEach((m, i) => (m.visible = wasVisible[i]));
  canvas.requestRenderAll();

  if (!cropRect) return full;
  const { x, y, w, h } = cropRect;
  const out = document.createElement('canvas');
  out.width = Math.round(w);
  out.height = Math.round(h);
  out.getContext('2d')!.drawImage(full, x, y, w, h, 0, 0, out.width, out.height);
  return out;
}

async function doPng(): Promise<void> {
  await downloadCanvas(flatten(), 'png', quality, meta.pageUrl);
  toast('Saved PNG');
}
async function doJpg(): Promise<void> {
  await downloadCanvas(flatten(), 'jpeg', quality, meta.pageUrl);
  toast('Saved JPEG');
}
async function doPdf(): Promise<void> {
  toast('Building PDF…');
  const opts = await loadOptions();
  await exportCanvasToPdf(flatten(), {
    pageUrl: meta.pageUrl,
    capturedAt: meta.capturedAt,
    quality,
    stamp: opts.stampUrlAndDate,
  });
  toast('Saved PDF');
}
async function doCopy(): Promise<void> {
  try {
    await copyCanvas(flatten());
    toast('Copied to clipboard');
  } catch {
    toast('Clipboard blocked — click the page and retry', true);
  }
}

/* ------------------------------ wiring ------------------------------ */

document.querySelectorAll<HTMLButtonElement>('.tool').forEach((btn) =>
  btn.addEventListener('click', () => setTool(btn.dataset.tool as Tool)),
);

colorInput.addEventListener('input', () => {
  color = colorInput.value;
  const active = canvas.getActiveObjects();
  if (active.length) {
    active.forEach((o) => {
      if ('stroke' in o) o.set('stroke', color);
      if (o instanceof fabric.Textbox) o.set('fill', color);
    });
    canvas.requestRenderAll();
    pushHistory();
  }
});
widthInput.addEventListener('input', () => {
  strokeWidth = Number(widthInput.value);
  const active = canvas.getActiveObjects();
  if (active.length) {
    active.forEach((o) => 'strokeWidth' in o && o.set('strokeWidth', strokeWidth));
    canvas.requestRenderAll();
    pushHistory();
  }
});

document.getElementById('delete')!.addEventListener('click', deleteSelection);
resetCropBtn.addEventListener('click', () => {
  cropRect = null;
  updateMask();
});
undoBtn.addEventListener('click', () => void undo());
redoBtn.addEventListener('click', () => void redo());
document.getElementById('zoom-in')!.addEventListener('click', () => applyZoom(Math.min(4, zoom * 1.2)));
document.getElementById('zoom-out')!.addEventListener('click', () => applyZoom(Math.max(0.1, zoom / 1.2)));
document.getElementById('zoom-fit')!.addEventListener('click', fitZoom);
document.getElementById('export-png')!.addEventListener('click', () => void doPng());
document.getElementById('export-jpg')!.addEventListener('click', () => void doJpg());
document.getElementById('export-pdf')!.addEventListener('click', () => void doPdf());
document.getElementById('copy')!.addEventListener('click', () => void doCopy());

canvas.on('object:modified', () => pushHistory());
canvas.on('path:created', () => {
  raiseMask();
  pushHistory();
});

function deleteSelection(): void {
  const active = canvas.getActiveObjects().filter((o) => !isMask(o));
  if (!active.length) return;
  active.forEach((o) => canvas.remove(o));
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  pushHistory();
}

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select', c: 'crop', r: 'redact', a: 'arrow', b: 'rect', e: 'ellipse', t: 'text', p: 'pen', h: 'highlight',
};

window.addEventListener('keydown', (e) => {
  const editing = (canvas.getActiveObject() as fabric.Textbox | undefined)?.isEditing;
  const target = e.target as HTMLElement;
  if (editing || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    void (e.shiftKey ? redo() : undo());
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    void redo();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelection();
    return;
  }
  const t = TOOL_KEYS[e.key.toLowerCase()];
  if (t) setTool(t);
});

window.addEventListener('resize', () => fitZoom());

/* ------------------------------ boot ------------------------------ */

async function boot(): Promise<void> {
  if (!captureId) {
    loadingEl.textContent = 'No capture specified.';
    return;
  }
  const entry = await getCapture(captureId);
  if (!entry) {
    loadingEl.textContent = 'Capture not found (it may have expired).';
    return;
  }
  meta = { pageUrl: entry.pageUrl, capturedAt: entry.capturedAt };
  quality = (await loadOptions()).jpegQuality;

  const url = URL.createObjectURL(entry.blob);
  const img = await loadImage(url);
  bgSource = img;
  natW = img.naturalWidth;
  natH = img.naturalHeight;

  const bg = new fabric.FabricImage(img, { selectable: false, evented: false, hoverCursor: 'default' });
  canvas.backgroundImage = bg;

  for (let i = 0; i < 4; i++) {
    const m = new fabric.Rect({ fill: 'rgba(11,18,32,0.55)', selectable: false, evented: false, visible: false, objectCaching: false });
    mask.push(m);
    canvas.add(m);
  }

  fitZoom();
  canvas.requestRenderAll();
  loadingEl.hidden = true;

  history = [];
  historyIdx = -1;
  pushHistory(); // baseline empty state
  setTool('select');

  if (autoAction === 'pdf') void doPdf();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load capture image.'));
    img.src = src;
  });
}

// E2E-only: expose internals so the harness can assert object counts and flatten output.
if (__FULLSHOT_TEST__) {
  (window as unknown as { __fullshot?: unknown }).__fullshot = {
    canvas,
    setTool,
    objectCount: () => canvas.getObjects().filter((o) => !isMask(o)).length,
    historyLen: () => history.length,
    dims: () => ({ w: natW, h: natH }),
    flatten,
  };
}

void boot();
