/** Popup: kicks off a capture and reflects progress. The background does the actual work, so
 * the capture completes even if the popup closes (e.g. when the editor tab opens and steals focus). */
import type { CaptureEvent, CaptureMode, CaptureScope, StartCaptureResponse } from '@/lib/types';

const editBtn = document.getElementById('capture-edit') as HTMLButtonElement;
const quickBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.btn--ghost'));
const statusEl = document.getElementById('status') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLDivElement;
const statusFill = document.getElementById('status-fill') as HTMLDivElement;
const openOptions = document.getElementById('open-options') as HTMLAnchorElement;
const scopeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="scope"]'));
const captureTitle = document.getElementById('capture-title') as HTMLSpanElement;
const captureSub = document.getElementById('capture-sub') as HTMLSpanElement;
const shortcutHint = document.getElementById('shortcut-hint') as HTMLSpanElement;

// The main button's text for each scope. The popup always opens on "Full page".
const SCOPE_TEXT: Record<CaptureScope, { title: string; sub: string }> = {
  full: { title: 'Capture full page', sub: 'Scroll, stitch & open the editor' },
  visible: { title: 'Capture visible area', sub: 'What you see now, in the editor' },
  area: { title: 'Select an area', sub: 'Drag on the page, then edit' },
};

function currentScope(): CaptureScope {
  return (scopeInputs.find((input) => input.checked)?.value as CaptureScope | undefined) ?? 'full';
}

function updateScopeText(): void {
  const text = SCOPE_TEXT[currentScope()];
  captureTitle.textContent = text.title;
  captureSub.textContent = text.sub;
}
scopeInputs.forEach((input) => input.addEventListener('change', updateScopeText));

// The tab this popup was opened for: the one the browser just granted activeTab for. Resolved
// once, so a tab opened later (e.g. the editor) can never become the capture target by accident.
const targetTab = chrome.tabs
  .query({ active: true, currentWindow: true })
  .then(([tab]) => tab?.id)
  .catch(() => undefined);

// True while this popup waits for the response to its own START_CAPTURE.
let waiting = false;

function setBusy(busy: boolean): void {
  editBtn.disabled = busy;
  quickBtns.forEach((b) => (b.disabled = busy));
  scopeInputs.forEach((input) => (input.disabled = busy));
}

function showStatus(text: string, pct?: number, error = false): void {
  statusEl.hidden = false;
  statusEl.classList.toggle('status--error', error);
  statusText.textContent = text;
  if (typeof pct === 'number') statusFill.style.width = `${Math.round(pct)}%`;
}

async function start(mode: CaptureMode): Promise<void> {
  waiting = true;
  setBusy(true);
  showStatus('Preparing…', 3);
  try {
    const tabId = await targetTab;
    if (tabId === undefined) throw new Error('No tab to capture.');
    const scope = currentScope();
    const res: StartCaptureResponse | undefined = await chrome.runtime.sendMessage({ type: 'START_CAPTURE', mode, tabId, scope });
    if (!res) throw new Error('No response from FullShot. Try again.');
    if (res.ok && res.pending === 'area') {
      // The page shows the selection overlay now; close so the person can drag on it.
      window.close();
      return;
    }
    if (res.ok) {
      showStatus(mode === 'edit' ? 'Opened in the editor.' : `Saved ${mode.toUpperCase()} to your downloads.`, 100);
    } else {
      showStatus(res.error, undefined, true);
    }
  } catch (err) {
    showStatus(err instanceof Error ? err.message : 'Capture failed.', undefined, true);
  } finally {
    waiting = false;
    setBusy(false);
  }
}

editBtn.addEventListener('click', () => void start('edit'));
quickBtns.forEach((btn) =>
  btn.addEventListener('click', () => void start(btn.dataset.mode as CaptureMode)),
);

// Show the shortcuts as the browser has them (the person can change them).
chrome.commands
  .getAll()
  .then((commands) => {
    const keys = commands.filter((c) => c.shortcut).map((c) => c.shortcut);
    if (keys.length) shortcutHint.textContent = `Shortcuts: ${keys.join(' · ')}`;
    shortcutHint.title = commands
      .filter((c) => c.shortcut)
      .map((c) => `${c.shortcut}: ${c.description || 'Open FullShot'}`)
      .join('\n');
  })
  .catch(() => {});

openOptions.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Progress broadcasts also reach a popup reopened while a capture runs; keep its buttons disabled.
chrome.runtime.onMessage.addListener((msg: CaptureEvent) => {
  if (!msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'CAPTURE_PROGRESS':
      setBusy(true);
      showStatus(`Capturing… ${msg.done}/${msg.total}`, (msg.done / msg.total) * 95);
      break;
    case 'CAPTURE_DONE':
      showStatus('Done — finishing export…', 100);
      if (!waiting) setBusy(false); // a capture started from an earlier popup
      break;
    case 'CAPTURE_ERROR':
      showStatus(msg.message, undefined, true);
      setBusy(false);
      break;
  }
});
