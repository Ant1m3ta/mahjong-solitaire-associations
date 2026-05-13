# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Browser prototype of a mahjong-style word solitaire game. TypeScript + React (Vite), plain DOM/CSS rendering, native HTML5 drag-and-drop. Desktop only. See `DESIGN.md` for the full game design — it is the source of truth for rules and should be re-read before changing mechanics.

## Commands

- `npm run dev` — start Vite dev server.
- `npm run build` — type-check (`tsc`) then build (`vite build`). Use this to validate TypeScript; there is no separate lint or test script.
- `npm run preview` — preview the production build.

No tests exist. There is no linter. Verify changes by running the dev server and exercising the affected mechanic.

## Architecture

### State model (single reducer)

The whole game runs through one reducer in `src/game/reducer.ts`. The top-level shape is `AppState = { state: GameState, history: GameState[], outcome, lastError }`. Every successful move pushes the prior `GameState` onto `history`; `ROLLBACK` pops it. `RESET` rebuilds via `buildInitialState` in `src/game/init.ts`. Outcome (`playing` | `won` | `lost`) is recomputed from `GameState` after each move and gates further actions in the reducer; the App also shows a blocking `Overlay` when not `playing`.

Move semantics live in `src/game/moves.ts` (`applyAction` dispatches over the `Action` union, throwing on invalid moves; the reducer catches and stores the message in `lastError`). All move-cost accounting is centralized there.

Types are in `src/types.ts`. `Action` is the set of in-game moves; `AppAction` adds meta actions (`ROLLBACK`, `RESET`, `ADD_BONUS_SLOT`).

### Board geometry (half-tile grid)

The board uses a half-tile coordinate system — this is the most subtle part of the codebase. Cards have integer `(x, y, z)` where `x, y` are in half-card units (a card's footprint is a 2×2 block of cells) and `z` is an explicit layer. **There is no `halfOffset` flag** — odd-parity coordinates are implicitly half-offset.

Two rules govern interactivity, both in `src/game/coverage.ts`:

1. **Coverage** (`isSlotRevealed`): a slot is covered if any overlapping-footprint slot has a higher *effective layer* `z * 100 + (stackDepth - 1)`. The `*100` weighting means a same-position-stacked card always counts as visually higher than a same-`z` half-offset neighbour — this matches the CSS `z-index` used in `Board.tsx`. Covered cards render face-down and are non-interactive.
2. **Side-blocking** (`isSlotSideBlocked`): mahjong-style edge rule. The top card is locked only if *all four* cardinal neighbours at `(±2, 0)` / `(0, ±2)` contain a card at the same `z`. Locked cards stay face-up but cannot be dragged or dropped onto.

`isSlotInteractive` = revealed AND not side-blocked. Any change to coverage logic must keep these two checks consistent with the rendering math in `Board.tsx` (`HALF_W`, `HALF_H`, `LAYER_LIFT`, `STACK_VISUAL_OFFSET_Y`, and the `effectiveLayer` formula).

### Board slots and stacks

A `BoardSlot` is one `(x, y)` position holding a vertical stack of `BoardCardEntry { card, z }`. Level data may declare same-`(x,y)` cards with different `z` (authored stacking); runtime Board→Board / Hand→Board drops append with `z = currentTop.z + 1`. Only the top of a stack is interactive. **Once a slot empties it becomes permanently `dead`** — `removeTopFromSlot` sets this and no further drops are accepted.

### Category slots

`CategorySlot { lockedCategory, displayedCard, cardsConsumed }`. Empty slot accepts only category cards (locks the slot); occupied slot accepts only matching-category simple cards (consumes them, increments `cardsConsumed`). When all simple cards of the locked category have been consumed across the level (`consumedSimple` filtered by category), the slot auto-clears back to empty. This auto-clear happens inside `placeCardInCategorySlot` in `moves.ts` and is global, not per-slot — multiple slots locked to the same category share the count via the level-wide consumed list.

`ADD_BONUS_SLOT` appends a one-time extra empty slot; `bonusSlotUsed` gates it.

### Win/loss

`isWon`: all simple cards across all categories have been consumed (`consumedSimple.length >= totalSimpleInLevel`). `isLost`: `movesUsed >= movesLimit` and not won. `movesLimit < 0` means unlimited.

### UI layout

Four stacked containers rendered by `App.tsx`: `Header` (stock / hand / moves), `CategorySlotsRow`, `Board`, `Footer` (level picker, highlight toggle, rollback). All components are dumb — they read `GameState` and dispatch `AppAction`. Drag-and-drop uses the native HTML5 API with a custom MIME type via `src/components/dragData.ts` (`hand` or `board` source kinds).

The `highlightUnplayable` UI toggle dims cards with no legal destination ("stranded"). When on, stranded cards are also non-draggable (see `Board.tsx` and `Header.tsx`); they remain valid drop *targets* though, so other cards can still stack on them.

### Levels

Levels are JSON in `src/levels/`, picked up by `src/levels/index.ts` via `import.meta.glob('./*.json', { eager: true })` and sorted by filename (numeric-aware). Adding a level: drop a new `*.json` file in the folder — no code edit needed. Format documented in `DESIGN.md`. A `cardId` resolves first against `categoryId` (becomes a category card) then against any `wordId` (becomes a simple card of that category) — see `createCardFromId` in `src/game/cards.ts`. Card UIDs are reset per level load via `resetUidForLevel`.

Words can optionally render as images (`icon: true` + `imageId` referencing `/public/images/<imageId>.png`).
