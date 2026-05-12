import type { LevelData } from '../types';
import type { SkeletonLevel } from './types';
import { SKELETON_SCHEMA } from './skeletonIO';

export const PREVIEW_KEY = 'editor.previewLevel';

// ─────────────────────────────────────────────────────────────────────────────
// File save: overwrite-in-place via File System Access API (Chromium),
// blob-download fallback elsewhere. Handles persist per "kind" within the
// page session.
// ─────────────────────────────────────────────────────────────────────────────

type Kind = 'level' | 'skel';

const _handles: { level: FileSystemFileHandle | null; skel: FileSystemFileHandle | null } = {
  level: null,
  skel: null,
};

export function boundSaveFilename(kind: Kind): string | null {
  return _handles[kind]?.name ?? null;
}

export function clearSaveHandle(kind: Kind): void {
  _handles[kind] = null;
}

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

interface SaveOpts {
  forcePrompt?: boolean;
}

async function pickFile(suggestedName: string): Promise<FileSystemFileHandle | null> {
  try {
    const handle = await (window as unknown as {
      showSaveFilePicker: (opts: {
        suggestedName: string;
        types?: { description: string; accept: Record<string, string[]> }[];
      }) => Promise<FileSystemFileHandle>;
    }).showSaveFilePicker({
      suggestedName,
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    });
    return handle;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    throw e;
  }
}

async function writeText(handle: FileSystemFileHandle, content: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
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

async function saveText(content: string, suggestedName: string, kind: Kind, opts: SaveOpts): Promise<string | null> {
  if (!supportsFileSystemAccess()) {
    fallbackDownload(content, suggestedName);
    return suggestedName;
  }
  let handle = _handles[kind];
  if (!handle || opts.forcePrompt) {
    const picked = await pickFile(suggestedName);
    if (!picked) return null;
    handle = picked;
    _handles[kind] = handle;
  }
  await writeText(handle, content);
  return handle.name;
}

export function saveLevelJSON(
  level: LevelData,
  suggestedName: string,
  opts: SaveOpts = {},
): Promise<string | null> {
  return saveText(JSON.stringify(level, null, 2), suggestedName, 'level', opts);
}

export function saveSkeletonJSON(
  skeleton: SkeletonLevel,
  suggestedName: string,
  opts: SaveOpts = {},
): Promise<string | null> {
  const payload = { $schema: SKELETON_SCHEMA, ...skeleton };
  return saveText(JSON.stringify(payload, null, 2), suggestedName, 'skel', opts);
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
