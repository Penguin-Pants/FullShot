/** Build a safe, descriptive download filename from a page URL + timestamp. */
export function buildFilename(pageUrl: string, capturedAt: number, ext: string): string {
  let host = 'page';
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, '') || 'page';
  } catch {
    /* leave default */
  }
  const d = new Date(capturedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const safeHost = host.replace(/[^a-z0-9.-]/gi, '_');
  return `fullshot_${safeHost}_${stamp}.${ext}`;
}
