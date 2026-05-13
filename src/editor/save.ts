import type { LevelData } from '../types';

export const PREVIEW_KEY = 'editor.previewLevel';

// ─────────────────────────────────────────────────────────────────────────────
// File save: the user first picks a destination folder via the File System
// Access API; subsequent saves write `<folder>/<suggestedName>` directly with
// no extra OS prompt. Non-Chromium browsers fall back to blob downloads and
// don't need a folder.
// ─────────────────────────────────────────────────────────────────────────────

let _folderHandle: FileSystemDirectoryHandle | null = null;

export function boundSaveFolder(): string | null {
  return _folderHandle?.name ?? null;
}

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function pickSaveFolder(): Promise<string | null> {
  if (!supportsDirectoryPicker()) return null;
  try {
    const handle = await (
      window as unknown as {
        showDirectoryPicker: (opts?: {
          mode?: 'read' | 'readwrite';
        }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker({ mode: 'readwrite' });
    _folderHandle = handle;
    return handle.name;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    throw e;
  }
}

async function writeFileInFolder(
  folder: FileSystemDirectoryHandle,
  name: string,
  content: string,
): Promise<void> {
  const fileHandle = await folder.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

export interface LevelFileEntry {
  name: string;
  level: LevelData;
}

function looksLikeLevel(data: unknown): data is LevelData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.levelId === 'string' &&
    Array.isArray(d.categories) &&
    Array.isArray(d.board) &&
    Array.isArray(d.stock)
  );
}

export async function listLevelsInFolder(): Promise<LevelFileEntry[]> {
  if (!_folderHandle) return [];
  const dir = _folderHandle as FileSystemDirectoryHandle & {
    entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
  };
  const entries: LevelFileEntry[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file') continue;
    if (!name.endsWith('.json') || name.endsWith('.skel.json')) continue;
    try {
      const file = await (handle as FileSystemFileHandle).getFile();
      const text = await file.text();
      const data = JSON.parse(text);
      if (!looksLikeLevel(data)) continue;
      entries.push({ name, level: data });
    } catch {
      // Skip unreadable / malformed entries.
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return entries;
}

function fallbackDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveText(content: string, suggestedName: string): Promise<string | null> {
  if (!supportsFileSystemAccess()) {
    fallbackDownload(content, suggestedName);
    return suggestedName;
  }
  if (!_folderHandle) {
    throw new Error('Pick a save folder first.');
  }
  await writeFileInFolder(_folderHandle, suggestedName, content);
  return suggestedName;
}

export function saveLevelJSON(level: LevelData, suggestedName: string): Promise<string | null> {
  return saveText(JSON.stringify(level, null, 2), suggestedName);
}

// Cached at module scope so a second call (Strict Mode double-mount, repeat
// renders, etc.) returns the same value instead of reading an already-cleared
// sessionStorage entry. Cleared whenever a new preview is stashed.
let _cached: LevelData | null | undefined;

export function storePreviewAndPlay(level: LevelData) {
  sessionStorage.setItem(PREVIEW_KEY, JSON.stringify(level));
  _cached = undefined;
  // Timestamped hash so every Play produces a hashchange and App remounts,
  // even across consecutive plays.
  window.location.hash = `#/?preview=${Date.now()}`;
}

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
