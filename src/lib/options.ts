import { DEFAULT_OPTIONS, OPTIONS_KEY, type FullShotOptions } from './types';

/** Load user options from chrome.storage.sync, falling back to defaults. */
export async function loadOptions(): Promise<FullShotOptions> {
  const stored = await chrome.storage.sync.get(OPTIONS_KEY);
  return { ...DEFAULT_OPTIONS, ...(stored[OPTIONS_KEY] ?? {}) } as FullShotOptions;
}

/** Persist a partial options update. */
export async function saveOptions(partial: Partial<FullShotOptions>): Promise<FullShotOptions> {
  const current = await loadOptions();
  const next = { ...current, ...partial };
  await chrome.storage.sync.set({ [OPTIONS_KEY]: next });
  return next;
}
