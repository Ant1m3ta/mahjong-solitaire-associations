import { useEffect, useMemo, useState } from 'react';
import { overrideKey } from './batchFill';
import {
  buildImagePlan,
  imageIdFor,
  pickImageCategory,
  prettyToken,
  resolveImageLevel,
  type ImageRow,
  type ImageSlot,
} from './imageSwap';
import { saveLevelJSON, type LevelFileEntry } from './save';

interface Props {
  entries: LevelFileEntry[];
  needsFolder: boolean;
  boundFolder: string | null;
  onPickFolder: () => void;
  onWrote: () => void;
  onClose: () => void;
}

const IMG_BASE = `${import.meta.env.BASE_URL}images/`;

export function ImagesModal({ entries, needsFolder, boundFolder, onPickFolder, onWrote, onClose }: Props) {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const plan = useMemo(() => buildImagePlan(entries, overrides), [entries, overrides]);

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // Image category ids already in use across this level — never pick a duplicate.
  function usedIds(row: ImageRow): Set<string> {
    return new Set(row.slots.map((s) => s.categoryId.toLowerCase()));
  }

  function setOverride(name: string, letter: string, id: string) {
    setOverrides((prev) => ({ ...prev, [overrideKey(name, letter)]: id }));
  }

  function imagize(row: ImageRow, slot: ImageSlot) {
    const pick = pickImageCategory(slot.distinctWords, usedIds(row));
    if (!pick) {
      setError(`No image category has ≥ ${slot.distinctWords} words for slot ${slot.letter}.`);
      return;
    }
    setError(null);
    setOverride(row.name, slot.letter, pick.categoryId);
  }

  function reset(row: ImageRow, slot: ImageSlot) {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[overrideKey(row.name, slot.letter)];
      return next;
    });
  }

  function autoImagize(row: ImageRow) {
    const exclude = usedIds(row);
    const next: Record<string, string> = { ...overrides };
    let any = false;
    for (const slot of row.slots) {
      if (slot.swapped || slot.isImage) continue;
      const pick = pickImageCategory(slot.distinctWords, exclude);
      if (!pick) continue;
      exclude.add(pick.categoryId.toLowerCase());
      exclude.delete(slot.categoryId.toLowerCase());
      next[overrideKey(row.name, slot.letter)] = pick.categoryId;
      any = true;
    }
    if (!any) {
      setError(`No convertible categories in ${row.name}.`);
      return;
    }
    setError(null);
    setOverrides(next);
  }

  async function saveLevel(row: ImageRow) {
    const entry = entries.find((e) => e.name === row.name);
    if (!entry) return;
    setBusy(row.name);
    setError(null);
    setSavedNote(null);
    try {
      const level = resolveImageLevel(entry, overrides);
      await saveLevelJSON(level, row.name);
      setSavedNote(`Saved ${row.name}.`);
      // Swaps are now baked into the file; drop this level's pending overrides.
      setOverrides((prev) => {
        const prefix = `${row.name} `;
        const kept: Record<string, string> = {};
        for (const k of Object.keys(prev)) if (!k.startsWith(prefix)) kept[k] = prev[k];
        return kept;
      });
      onWrote();
    } catch (e) {
      setError(`${row.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const needsPick = needsFolder && !boundFolder;
  const unsupported = !needsFolder;
  const swappedLevels = plan.filter((r) => r.swapCount > 0).length;

  function thumbFor(slot: ImageSlot, token: string): string {
    return `${IMG_BASE}${imageIdFor(slot.categoryId, token)}.png`;
  }

  return (
    <div className="picker-overlay" onClick={() => !busy && onClose()}>
      <div className="picker-modal batch-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <span>Images</span>
          <span className="picker-constraint">swap categories to pictures</span>
          <button className="editor-btn small" onClick={onClose} disabled={!!busy}>×</button>
        </div>

        {unsupported ? (
          <div className="batch-body">
            <div className="warn-row warn-error">
              The Images tool writes files in place via the File System Access API. Open the editor
              in Chrome / Edge / Arc / Brave to use it.
            </div>
          </div>
        ) : needsPick ? (
          <div className="batch-body">
            <div className="editor-empty">Pick the levels folder to scan and write back into.</div>
            <button className="editor-btn primary" onClick={onPickFolder}>Pick folder…</button>
          </div>
        ) : entries.length === 0 ? (
          <div className="batch-body">
            <div className="editor-empty">No level files found in {boundFolder}.</div>
          </div>
        ) : (
          <>
            <div className="batch-controls">
              <div className="batch-select-actions">
                <span className="batch-folder">→ {boundFolder}</span>
              </div>
              <span className="batch-ai">Pick a level, swap categories to image-ready ones, save.</span>
            </div>

            <div className="batch-rows">
              {plan.map((row) => {
                const isOpen = expanded.has(row.name);
                const expandable = row.status === 'ok';
                return (
                  <div key={row.name}>
                    <div className={`batch-row${row.status === 'error' ? ' bad' : ''}`}>
                      <button
                        className="batch-chevron"
                        onClick={() => expandable && toggleExpand(row.name)}
                        disabled={!expandable}
                      >
                        {expandable ? (isOpen ? '▼' : '▶') : ''}
                      </button>
                      <span className="batch-row-name">{row.name}</span>
                      {row.status === 'error' && <span className="batch-row-error">{row.error}</span>}
                      {expandable && (
                        <span className="batch-badge">{row.imageSlotCount}/{row.slots.length} image</span>
                      )}
                      {row.swapCount > 0 && <span className="batch-badge warn">{row.swapCount} pending</span>}
                      {row.hasProblem && <span className="batch-badge bad">unresolved</span>}
                    </div>
                    {expandable && isOpen && (
                      <div className="batch-cats">
                        <div className="batch-fix-toolbar">
                          <button
                            className="editor-btn small"
                            onClick={() => autoImagize(row)}
                            disabled={!!busy}
                            title="Swap every non-image category to a random image-ready one"
                          >
                            🖼 Imagize all
                          </button>
                          <button
                            className="editor-btn small primary"
                            onClick={() => saveLevel(row)}
                            disabled={!!busy || row.swapCount === 0 || row.hasProblem}
                            title="Write this level with the swapped image categories"
                          >
                            {busy === row.name ? 'Saving…' : 'Save level'}
                          </button>
                        </div>
                        {row.slots.map((slot) => (
                          <div className="batch-cat" key={slot.letter}>
                            <div className="batch-cat-head">
                              <span className="cat-letter">{slot.letter}</span>
                              <span className="batch-cat-name">{slot.categoryId}</span>
                              {slot.swapped && (
                                <span className="batch-tag">← {slot.originalCategoryId}</span>
                              )}
                              {slot.isImage && !slot.swapped && <span className="batch-tag">images</span>}
                              <span className={`batch-cat-count${slot.problem ? ' short' : ''}`}>
                                {slot.distinctWords} word{slot.distinctWords === 1 ? '' : 's'}
                              </span>
                              {slot.problem && <span className="batch-badge bad">{slot.problem}</span>}
                              <button
                                className="editor-btn small"
                                onClick={() => imagize(row, slot)}
                                disabled={!!busy}
                                title="Swap to a random image-ready category with enough words"
                              >
                                {slot.swapped ? '↻ reroll' : '🖼 imagize'}
                              </button>
                              {slot.swapped && (
                                <button
                                  className="editor-btn small"
                                  onClick={() => reset(row, slot)}
                                  disabled={!!busy}
                                  title="Restore the level's original category"
                                >
                                  reset
                                </button>
                              )}
                            </div>
                            <div className="img-thumbs">
                              {slot.isImage ? (
                                slot.tokens.map((t, k) => (
                                  <img
                                    key={`${t}-${k}`}
                                    className="img-thumb"
                                    src={thumbFor(slot, t)}
                                    alt={prettyToken(t)}
                                    title={prettyToken(t)}
                                    draggable={false}
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.visibility = 'hidden';
                                    }}
                                  />
                                ))
                              ) : (
                                slot.tokens.map((t, k) => (
                                  <span key={`${t}-${k}`} className="range-word">{t}</span>
                                ))
                              )}
                              {slot.distinctWords === 0 && (
                                <span className="range-empty-note">category card only</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="range-footer">
              <div className="range-status">
                <span>{swappedLevels} level{swappedLevels === 1 ? '' : 's'} with pending swaps</span>
                {savedNote && <span className="range-ok">{savedNote}</span>}
                {error && <span className="range-bad">{error}</span>}
              </div>
              <div className="range-actions">
                <button className="editor-btn primary" onClick={onClose} disabled={!!busy}>Done</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
