import type { Dispatch } from 'react';
import type { CategoryData } from '../types';
import type { CardKind, EditorAction, EditorState } from './types';
import { categoryCounts } from './reducer';
import { displayLetter, isPlaceholderCategory, simpleCounts } from './editorLevel';

interface Props {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  onOpenPicker: (index: number) => void;
  onOpenRangePicker: () => void;
}

export function CategoriesRail({ state, dispatch, onOpenPicker, onOpenRangePicker }: Props) {
  const counts = simpleCounts(state.level);
  return (
    <aside className="editor-rail editor-rail-left">
      <div className="editor-rail-title">
        <span>Categories</span>
        <button
          className="editor-btn small"
          disabled={state.level.categories.length === 0}
          onClick={() => dispatch({ type: 'FILL_BASIC' })}
          title="Theme every category to its same-letter basic entry (A→A, B→B, …). Words become 'a','b','c'…"
        >
          Basicify
        </button>
      </div>
      <div className="editor-rail-content">
        {state.level.categories.length === 0 ? (
          <div className="editor-empty">No categories yet.</div>
        ) : (
          state.level.categories.map((cat, i) => (
            <CategoryCard
              key={cat.categoryId}
              cat={cat}
              index={i}
              simpleTotal={counts[i]}
              state={state}
              dispatch={dispatch}
              onOpenPicker={onOpenPicker}
            />
          ))
        )}
      </div>
      <div className="add-category-row">
        <label className="add-category-default" title="Number of simple cards each new category starts with">
          default size
          <input
            className="editor-input small"
            type="number"
            min={0}
            value={state.defaultNewCategorySize}
            onChange={(e) =>
              dispatch({ type: 'SET_DEFAULT_NEW_CATEGORY_SIZE', size: Number(e.target.value) })
            }
          />
        </label>
        <button
          className="editor-btn add-category"
          onClick={() => dispatch({ type: 'ADD_CATEGORY' })}
        >
          + Add category
        </button>
      </div>
      <div className="fill-row">
        <button
          className="editor-btn"
          disabled={state.level.categories.length === 0}
          onClick={onOpenRangePicker}
          title="Fill every category from a contiguous slice of category_list.json, picking the start index. Words are written exactly as previewed; missing ones can be generated."
        >
          From list…
        </button>
        <button
          className="editor-btn"
          disabled={state.level.categories.length === 0}
          onClick={() => dispatch({ type: 'FILL_WORDS' })}
          title="Theme every category to its predefined real word category (A→Animals, B→Birds, …). Edit the mapping in basics.ts → WORD_FILL."
        >
          Fill words
        </button>
        <button
          className="editor-btn"
          disabled={state.level.categories.length === 0}
          onClick={() => dispatch({ type: 'CLEAR_PINS' })}
          title="Revert every themed category to an unthemed placeholder; a real category is picked at Save/Play."
        >
          Clear pins
        </button>
      </div>
    </aside>
  );
}

interface CardProps {
  cat: CategoryData;
  index: number;
  simpleTotal: number;
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  onOpenPicker: (index: number) => void;
}

function CategoryCard({ cat, index, simpleTotal, state, dispatch, onOpenPicker }: CardProps) {
  const counts = categoryCounts(state, index);
  const letter = displayLetter(index);
  const active = state.brush.categoryId === cat.categoryId && !state.eraseMode;
  const activeKind = state.brush.kind;
  const pinned = !isPlaceholderCategory(cat.categoryId);

  function selectBrush(kind: CardKind) {
    dispatch({ type: 'SET_BRUSH_CATEGORY', categoryId: cat.categoryId });
    dispatch({ type: 'SET_BRUSH_KIND', kind });
  }

  return (
    <div className={`cat-card${active ? ' active' : ''}`}>
      <div className="cat-card-header">
        <button
          className="cat-letter-btn"
          onClick={() => dispatch({ type: 'SET_BRUSH_CATEGORY', categoryId: cat.categoryId })}
          title="Select as brush"
        >
          <span className="cat-letter">{letter}</span>
        </button>
        <button
          className={`cat-pin${pinned ? ' pinned' : ''}`}
          onClick={() => onOpenPicker(index)}
          title={pinned ? `Themed as ${cat.categoryId}. Click to change.` : 'Random fill — click to theme with a real category.'}
        >
          📎 <span className="cat-pin-label">{pinned ? cat.categoryId : 'random'}</span>
        </button>
        <button
          className="cat-delete editor-btn small danger"
          onClick={() => dispatch({ type: 'REMOVE_CATEGORY', index })}
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
        total={simpleTotal}
        onBoard={counts.simpleOnBoard}
        inStock={counts.simpleInStock}
        active={active && activeKind === 'simple'}
        onSelect={() => selectBrush('simple')}
        onInc={() => dispatch({ type: 'INC_SIMPLE', index })}
        onDec={() => dispatch({ type: 'DEC_SIMPLE', index })}
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
