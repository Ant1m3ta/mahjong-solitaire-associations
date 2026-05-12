import { useEffect, useMemo, useState, type Dispatch } from 'react';
import type { EditorAction, SkeletonCategory } from './types';
import { pools } from './fill';

interface Props {
  letter: string;
  category: SkeletonCategory;
  onClose: () => void;
  dispatch: Dispatch<EditorAction>;
}

const MAX_RESULTS = 50;

export function CategoryPicker({ letter, category, onClose, dispatch }: Props) {
  const [query, setQuery] = useState('');
  const minWords = category.simpleCards;

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
    const { all } = pools();
    const q = query.trim().toLowerCase();
    const filtered = all.filter(
      (c) =>
        c.wordsIds.length >= minWords &&
        (q === '' || c.categoryId.toLowerCase().includes(q)),
    );
    filtered.sort((a, b) => a.categoryId.localeCompare(b.categoryId));
    return filtered.slice(0, MAX_RESULTS);
  }, [query, minWords]);

  function pick(categoryId: string) {
    dispatch({ type: 'SET_PINNED_CATEGORY', letter, categoryId });
    onClose();
  }

  function unpin() {
    dispatch({ type: 'SET_PINNED_CATEGORY', letter, categoryId: null });
    onClose();
  }

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <span>Pin <strong>{letter}</strong> to a real category</span>
          <span className="picker-constraint">≥ {minWords} word{minWords === 1 ? '' : 's'}</span>
          <button className="editor-btn small" onClick={onClose}>×</button>
        </div>
        <div className="picker-toolbar">
          <input
            autoFocus
            type="text"
            className="editor-input picker-search"
            placeholder="Search categories…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="editor-btn"
            onClick={unpin}
            disabled={!category.pinnedCategoryId}
            title="Clear the pin; fill will pick randomly."
          >
            Unpin
          </button>
        </div>
        <div className="picker-results">
          {matches.length === 0 ? (
            <div className="editor-empty">No categories match.</div>
          ) : (
            matches.map((c) => (
              <div
                key={c.categoryId}
                className={`picker-row${c.categoryId === category.pinnedCategoryId ? ' selected' : ''}`}
              >
                <span className={`picker-kind kind-${c.kind}`}>{c.kind}</span>
                <span className="picker-name">{c.categoryId}</span>
                <span className="picker-count">{c.wordsIds.length}w</span>
                <button className="editor-btn small primary" onClick={() => pick(c.categoryId)}>
                  Pick
                </button>
              </div>
            ))
          )}
          {matches.length === MAX_RESULTS && (
            <div className="picker-truncated">Showing first {MAX_RESULTS} matches. Refine search to see more.</div>
          )}
        </div>
      </div>
    </div>
  );
}
