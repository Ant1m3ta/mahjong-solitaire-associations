import type { LevelData } from '../types';

export const PREVIEW_KEY = 'editor.previewLevel';

export function downloadLevelJSON(level: LevelData, filename: string) {
  const json = JSON.stringify(level, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function storePreviewAndPlay(level: LevelData) {
  sessionStorage.setItem(PREVIEW_KEY, JSON.stringify(level));
  window.location.hash = '#/?preview=1';
}

// Cached at module scope so a second call (Strict Mode double-mount, repeat
// renders, etc.) returns the same value instead of reading an already-cleared
// sessionStorage entry.
let _cached: LevelData | null | undefined;

export function consumePreviewLevel(): LevelData | null {
  if (_cached !== undefined) return _cached;
  const raw = sessionStorage.getItem(PREVIEW_KEY);
  sessionStorage.removeItem(PREVIEW_KEY);
  if (!raw) {
    _cached = null;
    return null;
  }
  try {
    _cached = JSON.parse(raw) as LevelData;
  } catch {
    _cached = null;
  }
  return _cached;
}
