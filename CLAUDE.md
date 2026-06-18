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

Interactivity is governed by a single rule in `src/game/coverage.ts`:

**Coverage** (`isSlotRevealed`): a slot is covered if any overlapping-footprint slot has a higher *effective layer* `z * 100 + (stackDepth - 1)`. The `*100` weighting means a same-position-stacked card always counts as visually higher than a same-`z` half-offset neighbour — this matches the CSS `z-index` used in `Board.tsx`. Covered cards render face-down and are non-interactive. Any change to coverage logic must stay consistent with the rendering math in `Board.tsx` (`HALF_W`, `HALF_H`, `LAYER_LIFT`, `STACK_VISUAL_OFFSET_Y`, and the `effectiveLayer` formula).

### Board slots and stacks

A `BoardSlot` is one `(x, y)` position holding a vertical stack of `BoardCardEntry { card, z }`. Only the top of a stack is interactive. Stacks shrink only — cards can be removed from the top (sent to a category slot), but **board slots never accept new drops at runtime**. Level data may declare same-`(x,y)` cards with different `z` (authored stacking), and those cards peel off one at a time as the player clears the layers above. Once a slot empties it stays empty for the rest of the level.

### Category slots

`CategorySlot { lockedCategory, displayedCard, cardsConsumed }`. Empty slot accepts only category cards (locks the slot); occupied slot accepts only matching-category simple cards (consumes them, increments `cardsConsumed`). When all simple cards of the locked category have been consumed across the level (`consumedSimple` filtered by category), the slot auto-clears back to empty. This auto-clear happens inside `placeCardInCategorySlot` in `moves.ts` and is global, not per-slot — multiple slots locked to the same category share the count via the level-wide consumed list.

`ADD_BONUS_SLOT` appends a one-time extra empty slot; `bonusSlotUsed` gates it.

### Win/loss

`isWon`: all simple cards across all categories have been consumed (`consumedSimple.length >= totalSimpleInLevel`). `isLost`: `movesUsed >= movesLimit` and not won. `movesLimit < 0` means unlimited.

### UI layout

Four stacked containers rendered by `App.tsx`: `Header` (stock / hand / moves), `CategorySlotsRow`, `Board`, `Footer` (level picker, highlight toggle, rollback). All components are dumb — they read `GameState` and dispatch `AppAction`. Drag-and-drop uses the native HTML5 API with a custom MIME type via `src/components/dragData.ts` (`hand` or `board` source kinds).

The `highlightUnplayable` UI toggle dims cards with no legal destination ("stranded"). When on, stranded cards are also non-draggable (see `Board.tsx` and `Header.tsx`). Since the board never accepts drops, every drop goes to a `CategorySlot` via `CategorySlotsRow`.

### Levels

Levels are JSON in `src/levels/`, picked up by `src/levels/index.ts` via `import.meta.glob('./*.json', { eager: true })` and sorted by filename (numeric-aware). Adding a level: drop a new `*.json` file in the folder — no code edit needed. Format documented in `DESIGN.md`. A `cardId` resolves first against `categoryId` (becomes a category card) then against any `wordId` (becomes a simple card of that category) — see `createCardFromId` in `src/game/cards.ts`. Card UIDs are reset per level load via `resetUidForLevel`.

`src/levels/` here is a **prototype sandbox** — the shipping levels live in the sibling Unity project at `…/SoliJong/unity/soli-jong/Assets/Code/Common/Feature/SoliJong/Levels/` (identical `LevelData` JSON, one `*.json.meta` Unity file alongside each). The CLI tools below take a directory argument so they can analyse/fix that folder directly; they only rewrite existing `*.json` and never touch the `.meta` files.

Words can optionally render as images (`icon: true` + `imageId` referencing `/public/images/<imageId>.png`). Words may also carry `missing: true` and categories `incomplete: true` — placeholder markers the editor's base-fill tool writes for words it couldn't supply (see below); the game ignores them.

### Level editor (`src/editor/`, route `#/editor`)

A separate in-browser authoring tool; never part of gameplay (the build still bundles it). It has its own reducer (`reducer.ts`) over a `SkeletonLevel` — categories as `{ letter, simpleCards, pinnedCategoryId?, pinnedWords? }`, board/stock referenced by letter. `unfill.ts` turns a `LevelData` back into a skeleton; `fillSkeleton` in `fill.ts` turns a skeleton into `LevelData`, resolving categories/words from the catalog. Saving uses the File System Access API (`save.ts`): pick a folder once, then writes go straight to `<folder>/<name>.json` (Chrome/Edge; other browsers blob-download).

**Word catalog.** `catalog/words.json` is `[{ categoryId, wordsIds }]` — the lookup library; `pools()` in `fill.ts` caches it (merged with `basics.ts`). `catalog/category_list.json` is an ordered list of category names used to assign categories by index. Category-assignment logic for the batch tools is centralized in `rangeAssign.ts` (`computeAssignments`).

**Image catalog.** `catalog/image_categories.json` is a separate `[{ categoryId, wordsIds }]` list of *image-ready* categories — every wordId is the snake token of a PNG in `public/images/` (`<categoryId>__<wordId>.png`), so its words always render as pictures. Derived directly from the card-illustration filenames (only categories with ≥6 images were imported). It is **not** merged into `pools()` (many of its ids collide with text categories in `words.json`, which would corrupt base fill); it backs the Images tool only. `catalog/images.ts` (`AVAILABLE_IMAGES`) is the flat set of all `<imageId>` keys present in `public/images/`, regenerated from that folder; `fill.ts` checks it to decide whether a word emits `icon`/`imageId`.

**AI word generation (dev only).** A Vite middleware in `vite.config.ts` exposes `POST /__editor/generate-words`; it shells out to the local `claude` CLI (`--json-schema`, Haiku) — no API key, only exists under `vite dev`. Generated words are appended to `catalog/words.json` on disk *and* merged into the in-memory pool (`fill.addCatalogWords`); `wordGen.ts` is the client. Vite is configured to ignore `words.json` writes so growing the library mid-session doesn't trigger a reload.

**Solver & analyzers (`src/editor/solver/`).** Read-only checks run in a Web Worker (`solver.worker.ts`, debounced via `useSolver`) over the live skeleton and surface as chips in the canvas controls. (1) **Optimal solver** (`solverCore.ts`): A* over `GameState` using the real `applyAction`/`enumerateMoves`; reports min moves to win, or unsolvable. (2) **Difficulty** (`difficulty.ts`): BFS over decision states reporting a `failureHorizon` — the shallowest decision depth where a wrong choice kills the level. (3) **Straightforward analyzer** (`greedy.ts`, `GreedyChip`): simulates a no-lookahead player — feed matching simples first, then lock the **most-feedable** category (the one with the most reachable simples right now, board card or drawn card), and only **lock a category card on sight** (drawn card, or a board card to uncover) when nothing is immediately feedable. Softlock is detected by a `hashState` revisit on a full draw cycle. (Locking the most-feedable category rather than the first by board position is what stops a human-winnable level from being mis-flagged.) When the optimal solver wins but this one softlocks, the level is an **"order trap"** — stock category-card order lures the player into filling every slot before a needed category surfaces. A greedy win also proves solvability (its line is a valid solution), so it doubles as a cheap solvability witness when A\* times out.

**Stock draw order.** `applyDraw` (`moves.ts`) draws the **last** element of the stock array first; a held hand card returns to the front, so the deck recycles. Nothing reverses stock — `level.stock[i]`, `skel.stock[i]` and `GameState.stock[i]` are the same index (so one permutation applies to all three). The editor stock strip shows array order, first-drawn on the right.

**Tools menu — four tools, all write in place to the bound folder:**
- *Fill levels from list* (`BatchFillModal` / `batchFill.ts`): base fill. Walks all level files in order with a category-index cursor that accumulates over **every** valid level (so a level always starts at the index implied by all levels before it, regardless of selection); checkboxes + a write range choose which to (re)write. A category that can't supply enough words is written anyway, padding each missing card slot with a placeholder. No AI, no category replacement here.
- *Fix levels* (`BatchFixModal` / `batchFix.ts`): finds levels with missing words and resolves them per level — generate the missing words (AI) or replace a category with a random catalog one that has enough — then saves. Operates on each level's existing categories (no index reassignment).
- *Images* (`ImagesModal` / `imageSwap.ts`): per-level, swaps chosen categories to image-ready ones (from `image_categories.json`) so the tiles render pictures. Does **not** go through `fillSkeleton` — `imageSwap.ts` (`buildSwapResult`) surgically rewrites `LevelData`, mapping each slot's distinct words 1:1 onto an image category's tokens and remapping every board/stock `cardId`, so the placement/match structure (including words reused across many tiles) is preserved exactly. Picks must keep all `cardId`s unique; an unresolved slot (shortfall or id collision) is flagged and blocks save. Overrides reuse `overrideKey`/`overridesForLevel` from `batchFill.ts`, keyed by category letter.
- *Fix draw order* (`ReorderModal` / `batchReorder.ts`): finds **order traps** (straightforward player softlocks, see Solver & analyzers) and rewrites the stock so it no longer does. `reorderFix.ts` (`planStockReorder`) runs a greedy-safe constructive scheduler, then — since that scheduler can corner itself even when many winning orders exist (e.g. all category cards in the stock under a tight slot cap) — falls back to a **seeded verified random search** over stock orderings (`searchBudget`, default `REORDER_SEARCH_BUDGET`; the modal passes a smaller one to stay responsive). Every candidate is **verified by re-running the greedy sim** — a greedy win proves solvability, so no A\* re-check. Only traps with category cards on the board are genuinely unfixable by reorder. The reorder is **lossless**: it permutes the existing `stock` cardIds (never re-`fillSkeleton`), applied via `applyOrderToLevel` / `applyOrderToSkeleton` which share one index permutation. Board-driven traps (a category locked from the board, or its simples buried) are flagged unfixable rather than touched. The same fix is one click from `GreedyChip`'s "Fix order" button on the live skeleton (`APPLY_STOCK_ORDER`, undoable). CLI (both take an optional `[dir]`, default `src/levels`): `scripts/test-greedy.ts` reports the analyzer/reorder verdict per level; `scripts/fix-order.ts [dir] [--write]` batch-applies the reorder in place (dry-run by default, preserves each file's trailing-newline style). Point either at the Unity Levels folder to fix the shipping levels.

**Gap markers.** When base-fill is short it pads with placeholder words `(needs word N)` (unique level-wide), flagged `missing: true` on the `WordData` and `incomplete: true` on the `CategoryData`. `fillSkeleton(skel, { padGaps: true })` does the padding; without it, fill throws on a shortfall. A pinned category absent from the catalog is **not** a shortfall error — `pickReal` returns it as an empty category and `fillSkeleton` always pads its words with placeholders (regardless of `padGaps`), so such levels still save and the fix tool resolves them later. The fix tool locates levels by these markers (plus live shortfall against the current catalog) and clears them on save.
