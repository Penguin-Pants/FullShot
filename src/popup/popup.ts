/** Popup: kicks off a capture and reflects progress. The background does the actual work, so
 * the capture completes even if the popup closes (e.g. when the editor tab opens and steals focus). */
import type { CaptureEvent, CaptureMode, StartCaptureResponse } from '@/lib/types';

const editBtn = document.getElementById('capture-edit') as HTMLButtonElement;
const quickBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.btn--ghost'));
const statusEl = document.getElementById('status') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLDivElement;
const statusFill = document.getElementById('status-fill') as HTMLDivElement;
const openOptions = document.getElementById('open-options') as HTMLAnchorElement;

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
    const res: StartCaptureResponse | undefined = await chrome.runtime.sendMessage({ type: 'START_CAPTURE', mode, tabId });
    if (!res) throw new Error('No response from FullShot. Try again.');
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
