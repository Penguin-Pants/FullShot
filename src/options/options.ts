import { loadOptions, saveOptions } from '@/lib/options';

const openEditor = document.getElementById('openEditor') as HTMLInputElement;
const jpegQuality = document.getElementById('jpegQuality') as HTMLInputElement;
const jpegQualityOut = document.getElementById('jpegQualityOut') as HTMLOutputElement;
const stamp = document.getElementById('stamp') as HTMLInputElement;
const saved = document.getElementById('saved') as HTMLParagraphElement;

let savedTimer: number | undefined;
function flashSaved(): void {
  saved.hidden = false;
  if (savedTimer) clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => (saved.hidden = true), 1200);
}

async function persist(): Promise<void> {
  await saveOptions({
    openEditorAfterCapture: openEditor.checked,
    jpegQuality: Number(jpegQuality.value),
    stampUrlAndDate: stamp.checked,
  });
  flashSaved();
}

async function init(): Promise<void> {
  const opts = await loadOptions();
  openEditor.checked = opts.openEditorAfterCapture;
  jpegQuality.value = String(opts.jpegQuality);
  jpegQualityOut.textContent = opts.jpegQuality.toFixed(2);
  stamp.checked = opts.stampUrlAndDate;

  openEditor.addEventListener('change', persist);
  stamp.addEventListener('change', persist);
  jpegQuality.addEventListener('input', () => {
    jpegQualityOut.textContent = Number(jpegQuality.value).toFixed(2);
  });
  jpegQuality.addEventListener('change', persist);
}

void init();
