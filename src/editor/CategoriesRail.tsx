import type { Dispatch } from 'react';
import type { CardKind, EditorAction, EditorState, SkeletonCategory } from './types';
import { categoryCounts } from './reducer';

interface Props {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  onOpenPicker: (letter: string) => void;
}

export function CategoriesRail({ state, dispatch, onOpenPicker }: Props) {
  return (
    <aside className="editor-rail editor-rail-left">
      <div className="editor-rail-title">Categories</div>
      <div className="editor-rail-content">
        {state.level.categories.length === 0 ? (
          <div className="editor-empty">No categories yet.</div>
        ) : (
          state.level.categories.map((cat) => (
            <CategoryCard
              key={cat.letter}
              cat={cat}
              state={state}
              dispatch={dispatch}
              onOpenPicker={onOpenPicker}
            />
          ))
        )}
      </div>
      <button
        className="editor-btn add-category"
        onClick={() => dispatch({ type: 'ADD_CATEGORY' })}
      >
        + Add category
      </button>
    </aside>
  );
}

interface CardProps {
  cat: SkeletonCategory;
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  onOpenPicker: (letter: string) => void;
}

function CategoryCard({ cat, state, dispatch, onOpenPicker }: CardProps) {
  const counts = categoryCounts(state, cat.letter);
  const active = state.brush.letter === cat.letter && !state.eraseMode;
  const activeKind = state.brush.kind;

  function selectBrush(kind: CardKind) {
    dispatch({ type: 'SET_BRUSH_LETTER', letter: cat.letter });
    dispatch({ type: 'SET_BRUSH_KIND', kind });
  }

  return (
    <div className={`cat-card${active ? ' active' : ''}`}>
      <div className="cat-card-header">
        <button
          className="cat-letter-btn"
          onClick={() => dispatch({ type: 'SET_BRUSH_LETTER', letter: cat.letter })}
          title="Select as brush"
        >
          <span className="cat-letter">{cat.letter}</span>
        </button>
        <button
          className={`cat-pin${cat.pinnedCategoryId ? ' pinned' : ''}`}
          onClick={() => onOpenPicker(cat.letter)}
          title={cat.pinnedCategoryId ? `Pinned to ${cat.pinnedCategoryId}. Click to change.` : 'Random fill — click to pin a real category.'}
        >
          📎 <span className="cat-pin-label">{cat.pinnedCategoryId ?? 'random'}</span>
        </button>
        <button
          className="cat-delete editor-btn small danger"
          onClick={() => dispatch({ type: 'REMOVE_CATEGORY', letter: cat.letter })}
          title="Remove category"
        >
          ×
        </button>
      </div>
      <CountRow
        label="category"
        onBoard={counts.categoryOnBoard}
        inStock={counts.categoryInStock}
        active={active && activeKind === 'category'}
        onSelect={() => selectBrush('category')}
      />
      <CountRow
        label="simple"
        total={cat.simpleCards}
        onBoard={counts.simpleOnBoard}
        inStock={counts.simpleInStock}
        active={active && activeKind === 'simple'}
        onSelect={() => selectBrush('simple')}
        onInc={() => dispatch({ type: 'INC_SIMPLE', letter: cat.letter })}
        onDec={() => dispatch({ type: 'DEC_SIMPLE', letter: cat.letter })}
      />
    </div>
  );
}

interface CountRowProps {
  label: string;
  total?: number;
  onBoard: number;
  inStock: number;
  active: boolean;
  onSelect: () => void;
  onInc?: () => void;
  onDec?: () => void;
}

function CountRow({ label, total, onBoard, inStock, active, onSelect, onInc, onDec }: CountRowProps) {
  const showStepper = onInc !== undefined && onDec !== undefined && total !== undefined;
  return (
    <div className={`count-row${active ? ' active' : ''}${showStepper ? '' : ' no-stepper'}`}>
      <button className="count-label-btn" onClick={onSelect} title="Set brush kind">
        {label}
      </button>
      {showStepper ? (
        <div className="count-stepper">
          <button className="editor-btn small" onClick={onDec} disabled={(total ?? 0) <= 0}>−</button>
          <span className="count-total">{total}</span>
          <button className="editor-btn small" onClick={onInc}>+</button>
        </div>
      ) : (
        <span className="count-fixed" title="One per category">1</span>
      )}
      <div className="count-summary" title="on board / in stock">
        <span className="count-board">{onBoard}</span>
        <span className="count-sep">/</span>
        <span className="count-stock">{inStock}</span>
      </div>
    </div>
  );
}
