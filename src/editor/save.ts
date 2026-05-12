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

export function consumePreviewLevel(): LevelData | null {
  const raw = sessionStorage.getItem(PREVIEW_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(PREVIEW_KEY);
  try {
    return JSON.parse(raw) as LevelData;
  } catch {
    return null;
  }
}
