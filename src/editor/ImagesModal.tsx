import { useEffect, useMemo, useState } from 'react';
import { overrideKey } from './batchFill';
import {
  buildImagePlan,
  imageCatsWithAtLeast,
  ownImageCategory,
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
  // Open manual image-set picker for a specific slot.
  const [pickFor, setPickFor] = useState<{ name: string; letter: string; need: number } | null>(null);

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

  function setOverride(name: string, letter: string, id: string) {
    setOverrides((prev) => ({ ...prev, [overrideKey(name, letter)]: id }));
  }

  // Show a slot as its own category's pictures (matched by normalized name).
  function useOwn(row: ImageRow, slot: ImageSlot) {
    const own = ownImageCategory(slot.categoryId, slot.distinctWords);
    if (!own) {
      setError(`${slot.categoryId} has no image set with ≥ ${slot.distinctWords} pictures.`);
      return;
    }
    setError(null);
    setOverride(row.name, slot.letter, own.categoryId);
  }

  function reset(row: ImageRow, slot: ImageSlot) {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[overrideKey(row.name, slot.letter)];
      return next;
    });
  }

  // Bulk: set every category that has its own image set (and enough pictures)
  // to those pictures. Leaves categories without their own images for manual
  // picking — no random theme is ever assigned.
  function useOwnAll(row: ImageRow) {
    const next: Record<string, string> = { ...overrides };
    let any = false;
    for (const slot of row.slots) {
      if (slot.swapped) continue;
      if (slot.isImage && !slot.stale) continue;
      const own = ownImageCategory(slot.categoryId, slot.distinctWords);
      if (!own) continue;
      next[overrideKey(row.name, slot.letter)] = own.categoryId;
      any = true;
    }
    if (!any) {
      setError(`No categories with their own images in ${row.name}.`);
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

  return (
    <>
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
                      {expandable && (
                        <span className="batch-badge" title="categories with enough of their own pictures">
                          {row.ownReadyCount} own-ready
                        </span>
                      )}
                      {row.staleCount > 0 && <span className="batch-badge warn">{row.staleCount} stale</span>}
                      {row.swapCount > 0 && <span className="batch-badge warn">{row.swapCount} pending</span>}
                      {row.hasProblem && <span className="batch-badge bad">unresolved</span>}
                    </div>
                    {expandable && isOpen && (
                      <div className="batch-cats">
                        <div className="batch-fix-toolbar">
                          <button
                            className="editor-btn small"
                            onClick={() => useOwnAll(row)}
                            disabled={!!busy}
                            title="Show every category that has its own image set as those pictures (categories without their own images are left for manual picking)"
                          >
                            🖼 Use own (all)
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
                              {slot.isImage && !slot.swapped && !slot.stale && (
                                <span className="batch-tag">images</span>
                              )}
                              {slot.stale && <span className="batch-tag warn">stale</span>}
                              <span className={`batch-cat-count${slot.problem ? ' short' : ''}`}>
                                {slot.distinctWords} word{slot.distinctWords === 1 ? '' : 's'}
                              </span>
                              <OwnBadge slot={slot} />
                              {slot.problem && <span className="batch-badge bad">{slot.problem}</span>}
                              <span className="batch-cat-actions">
                                <button
                                  className="editor-btn small"
                                  onClick={() => useOwn(row, slot)}
                                  disabled={!!busy || slot.ownImageCount < slot.distinctWords || slot.distinctWords === 0}
                                  title="Show this category as its own pictures"
                                >
                                  use own
                                </button>
                                <button
                                  className="editor-btn small"
                                  onClick={() =>
                                    setPickFor({ name: row.name, letter: slot.letter, need: slot.distinctWords })
                                  }
                                  disabled={!!busy || slot.distinctWords === 0}
                                  title="Pick any image set for this category"
                                >
                                  pick…
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
                              </span>
                            </div>
                            <div className="img-thumbs">
                              {slot.imageIds.length > 0 ? (
                                slot.imageIds.map((imageId, k) => (
                                  <Thumb key={`${imageId}-${k}`} imageId={imageId} />
                                ))
                              ) : (
                                slot.tokens.map((t, k) => (
                                  <span key={`${t}-${k}`} className="range-word">{prettyToken(t)}</span>
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
    {pickFor && (
      <ImageSetPicker
        need={pickFor.need}
        onPick={(id) => {
          setOverride(pickFor.name, pickFor.letter, id);
          setPickFor(null);
        }}
        onClose={() => setPickFor(null)}
      />
    )}
    </>
  );
}

// Per-category availability: ✓ enough own pictures, ⚠ some but too few, — none.
function OwnBadge({ slot }: { slot: ImageSlot }) {
  if (slot.distinctWords === 0) return null;
  const n = slot.ownImageCount;
  if (n >= slot.distinctWords) {
    return <span className="own-chip own-ok" title={`${n} pictures generated for this category`}>✓ images: {n}</span>;
  }
  if (n > 0) {
    return (
      <span className="own-chip own-few" title={`only ${n} pictures, need ${slot.distinctWords}`}>
        ⚠ {n} &lt; {slot.distinctWords}
      </span>
    );
  }
  return <span className="own-chip own-none" title="no images generated for this category">— no images</span>;
}

// Searchable list of image sets (≥ the slot's word count) for manual override.
function ImageSetPicker({
  need,
  onPick,
  onClose,
}: {
  need: number;
  onPick: (categoryId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return imageCatsWithAtLeast(need)
      .filter((c) => q === '' || c.categoryId.includes(q))
      .sort((a, b) => a.categoryId.localeCompare(b.categoryId))
      .slice(0, 60);
  }, [query, need]);
  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <span>Pick an image set</span>
          <span className="picker-constraint">≥ {need} picture{need === 1 ? '' : 's'}</span>
          <button className="editor-btn small" onClick={onClose}>×</button>
        </div>
        <div className="picker-toolbar">
          <input
            autoFocus
            type="text"
            className="editor-input picker-search"
            placeholder="Search image sets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="picker-results">
          {matches.length === 0 ? (
            <div className="editor-empty">No image set has enough pictures.</div>
          ) : (
            matches.map((c) => (
              <div key={c.categoryId} className="picker-row">
                <span className="picker-kind kind-icon">icon</span>
                <span className="picker-name">{c.categoryId}</span>
                <span className="picker-count">{c.wordsIds.length}🖼</span>
                <button className="editor-btn small primary" onClick={() => onPick(c.categoryId)}>
                  Pick
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// A picture thumbnail that falls back to a visible "missing" box if the PNG
// isn't in public/images (e.g. a stale image id left over from another art set).
function Thumb({ imageId }: { imageId: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span className="img-thumb missing" title={`missing: ${imageId}.png`}>
        ?
      </span>
    );
  }
  return (
    <img
      className="img-thumb"
      src={`${IMG_BASE}${imageId}.png`}
      alt={imageId}
      title={imageId}
      draggable={false}
      onError={() => setBroken(true)}
    />
  );
}
