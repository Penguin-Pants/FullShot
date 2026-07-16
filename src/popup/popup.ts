/** Popup: kicks off a capture and reflects progress. The service worker does the actual work, so
 * the capture completes even if the popup closes (e.g. when the editor tab opens and steals focus). */

const editBtn = document.getElementById('capture-edit') as HTMLButtonElement;
const quickBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.btn--ghost'));
const statusEl = document.getElementById('status') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLDivElement;
const statusFill = document.getElementById('status-fill') as HTMLDivElement;
const openOptions = document.getElementById('open-options') as HTMLAnchorElement;

type Mode = 'edit' | 'png' | 'jpeg' | 'pdf';

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

async function start(mode: Mode): Promise<void> {
  setBusy(true);
  showStatus('Preparing…', 3);
  try {
    const res = await chrome.runtime.sendMessage({ type: 'START_CAPTURE', mode });
    if (res && res.ok === false) {
      showStatus(res.error ?? 'Capture failed.', undefined, true);
      setBusy(false);
    }
    // Otherwise progress/done messages drive the UI.
  } catch (err) {
    showStatus(err instanceof Error ? err.message : 'Capture failed.', undefined, true);
    setBusy(false);
  }
}

editBtn.addEventListener('click', () => start('edit'));
quickBtns.forEach((btn) =>
  btn.addEventListener('click', () => start(btn.dataset.mode as Mode)),
);

openOptions.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'CAPTURE_PROGRESS':
      showStatus(`Capturing… ${msg.done}/${msg.total}`, (msg.done / msg.total) * 95);
      break;
    case 'CAPTURE_DONE':
      showStatus('Done — finishing export…', 100);
      break;
    case 'CAPTURE_ERROR':
      showStatus(msg.message ?? 'Capture failed.', undefined, true);
      setBusy(false);
      break;
  }
});
