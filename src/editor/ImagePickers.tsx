import { useEffect, useMemo, useState } from 'react';
import { imageCatsWithAtLeast, imageIdFor, type ImageSlot } from './imageSwap';

// Shared picture-picker UI used by both the folder-batch Images tool
// (ImagesModal) and the current-level Words & images tool (LevelContentModal).

const IMG_BASE = `${import.meta.env.BASE_URL}images/`;

// A picture thumbnail that falls back to a visible "missing" box if the PNG
// isn't in public/images (e.g. a stale image id left over from another art set).
export function Thumb({ imageId, className = '' }: { imageId: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span className={`img-thumb missing ${className}`} title={`missing: ${imageId}.png`}>
        ?
      </span>
    );
  }
  return (
    <img
      className={`img-thumb ${className}`}
      src={`${IMG_BASE}${imageId}.png`}
      alt={imageId}
      title={imageId}
      draggable={false}
      onError={() => setBroken(true)}
    />
  );
}

// Per-category availability: ✓ enough own pictures, ⚠ some but too few, — none.
export function OwnBadge({ slot }: { slot: ImageSlot }) {
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
// Each row shows how many slots across the loaded levels already use that set.
export function ImageSetPicker({
  need,
  usage,
  onPick,
  onClose,
}: {
  need: number;
  usage: Map<string, number>;
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
            matches.map((c) => {
              const uses = usage.get(c.categoryId) ?? 0;
              return (
                <div key={c.categoryId} className="imgset-row">
                  <div className="imgset-head">
                    <span className="picker-name">{c.categoryId}</span>
                    <span className="picker-count">{c.wordsIds.length}🖼</span>
                    <span className="imgset-hint" title={`the first ${need} picture${need === 1 ? '' : 's'} (outlined) will be used`}>
                      uses first {need}
                    </span>
                    <span
                      className={`picker-uses${uses === 0 ? ' zero' : ''}`}
                      title={`used by ${uses} slot${uses === 1 ? '' : 's'} across the loaded levels`}
                    >
                      {uses === 0 ? 'unused' : `used ${uses}×`}
                    </span>
                    <button className="editor-btn small primary" onClick={() => onPick(c.categoryId)}>
                      Pick
                    </button>
                  </div>
                  <div className="imgset-thumbs">
                    {c.wordsIds.map((t, i) => (
                      <Thumb
                        key={t}
                        imageId={imageIdFor(c.categoryId, t)}
                        className={i < need ? 'sel' : 'unsel'}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
