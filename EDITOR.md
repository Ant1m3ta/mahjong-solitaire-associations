# Level Editor — Plan & Status

Browser-based skeleton editor for the word solitaire game. Authoring tool only; the runtime is unchanged. Reachable at `#/editor` (button "✏ Editor" in the game header).

## Concept

The editor edits an abstract **skeleton**: categories are labelled `A`, `B`, `C`… instead of concrete categories. On Save, the editor picks real categories from the Unity catalog at random (constrained by `kind` and word counts) and emits a normal `LevelData` JSON the existing runtime plays unchanged.

This means: the runtime never sees a skeleton. The editor's internal state is throwaway; only the filled `LevelData` is persisted (downloaded JSON or in-memory Play preview).

## Data model (editor-internal)

```
SkeletonLevel { levelId, slotsDefault, movesLimit, categories[], board[], stock[] }
SkeletonCategory { letter, kind: 'icon'|'text'|'any', categoryCards, simpleCards, pinnedCategoryId? }
SkeletonBoardCard { x, y, z, letter, kind: 'category'|'simple' }
SkeletonStockEntry { letter, kind }
EditorState { level, brush, currentLayer, ghostBelow, ghostAbove, eraseMode, lastError }
```

**Allocation invariant:** for each `(letter, kind)`, `count(board) + count(stock) === category.categoryCards | category.simpleCards`. Stock is the residual; cards never on board "fall through" to stock. The reducer enforces this on every action.

## Architecture

- `src/main.tsx` — hash router. `#/editor` → `<Editor/>`, else `<App/>`.
- `src/editor/types.ts` — Skeleton types + EditorAction union.
- `src/editor/reducer.ts` — pure reducer; invariant enforcement; `categoryCounts()` derived selector.
- `src/editor/Editor.tsx` — top-level shell, hotkeys, save/play wiring, meta fields.
- `src/editor/CategoriesRail.tsx` — left rail; one panel per category; +/- steppers; brush selector.
- `src/editor/BoardCanvas.tsx` — half-tile click grid, layer switching, ghost layers, placement, erase.
- `src/editor/fill.ts` — picks real categories from the Unity catalog, assigns distinct words.
- `src/editor/save.ts` — JSON download (Blob URL) + sessionStorage preview handoff.
- `src/editor/validate.ts` — derived warnings (unwinnable categories, half-offset coverage gotcha) + stats.
- `src/editor/catalog/icons.json`, `words.json` — copied from Unity (`Assets/Editor/Tools/LevelsCategoriesReplacement/categories/`).
- `src/editor/catalog/images.ts` — hand-maintained manifest of PNGs available under `public/images/`. Regen command in the file header.
- `src/editor/Editor.css` — editor-only styles.

`App.tsx` was extended: on mount it calls `consumePreviewLevel()` from sessionStorage; if present, prepends that level to the dropdown and starts there. The preview is read-once (cleared after consumption).

## Status (shipped)

- [x] **Phase 1 — Scaffold.** Hash routing, three-column shell, ✏ Editor link in game header, ← Game link back.
- [x] **Phase 2 — Skeleton state.** Types, reducer, all 17 actions, invariant maintained.
- [x] **Phase 3 — Categories rail.** Panel per category with letter, kind selector (icon/text/any), `cat`/`smp` rows with +/- steppers + board/stock counts. Active brush highlighted; `cat`/`smp` labels are clickable to set both letter and kind.
- [x] **Phase 4 — Board canvas.** Half-tile click grid, layer switching (◂/▸ buttons + `[`/`]` hotkeys), ghost-layer toggles below/above, click-to-place from brush, click-to-erase, hover preview of 2×2 footprint, brush kind toggle (`⇄` button + `Tab`).
- [x] **Phase 5 — Stock strip.** Horizontal chip list, ◂/▸/× per chip, category-card chips styled like the gold gradient.
- [x] **Phase 6 — Save & Play.** Catalog fill (random pick constrained by kind + word count, no duplicate real categories, distinct words per simple). Save = JSON file download. Play = stash filled level in sessionStorage, hash-jump to `#/`, App picks it up as level 0.
- [x] **Phase 7 — Validation panel.** Warnings: simples with no category card (unwinnable); cards hidden at start by half-offset coverage; icon-category over-asking word count. Stats: board count, stock count, side-blocked count, covered count.

Hotkeys: `[`/`]` layer, `E` erase, `Tab` simple↔category, `1..9` select category by index. Ignored when typing in inputs.

## Missing features (not in this milestone)

Priority guess in parentheses.

- **Drag-to-reorder stock** (low). Up/down arrows already work; drag is convenience.
- **Pin-to-real-category UI** (medium). `SkeletonCategory.pinnedCategoryId` is supported by `fill.ts` but the editor has no UI to set it. Needs a searchable dropdown — the words catalog has ~7,400 entries.
- **Load existing `levelN.json` back into the editor** (medium). Treat a concrete level as a skeleton with `pinnedCategoryId` on every category, letters auto-assigned `A`, `B`, … by category order. Useful for tweaking existing levels.
- **localStorage autosave + restore** (medium). Editor state currently lives only in component state; a reload wipes it.
- **BFS solvability check** (low). Validation flags obviously unwinnable layouts but doesn't prove a level is solvable. A "Run solver" button could try.
- **Re-roll button** (low). Same skeleton, re-run fill with a different RNG seed to pick different real categories.
- **Skeleton export/import** (low). Save/load the skeleton itself (separate from the concrete `LevelData`) for later re-rolls.
- **Image-category coverage hint** (low). When `kind=icon` and a designer cranks `simpleCards` very high, surface a hint of "max words available in any image category" so they understand the constraint.
- **Visual style for simple cards** (cosmetic). Currently a plain white card with a small lowercase letter — distinguishable from category cards but bland. Could tint by letter index for at-a-glance grouping.
- **Same-`(x,y)` stacking authoring** (subtle). Today, clicking `(x,y)` on layer `z` where the same `(x,y)` is occupied at `z` is rejected. Stacking at the same `(x,y)` across different `z` works (`(0,0,z=0)` then switch layer to `z=1`, click `(0,0)` — places `(0,0,z=1)`). This is correct but worth documenting; users may try clicking on a card and expect a stack to grow on the same layer.

## Catalog refresh

The image manifest is hand-maintained. To add new image categories:

1. Copy PNGs into `web/public/images/` using the convention `<category_lower>__<word_snake>.png`.
2. Regen `src/editor/catalog/images.ts` from the shell command in its file header.
3. If a new Unity category is needed, the JSON catalogs in `src/editor/catalog/{icons,words}.json` are direct copies of the Unity counterparts — re-copy from `Assets/Editor/Tools/LevelsCategoriesReplacement/categories/`.

## Routing & deploy

Hash-based routing keeps both the game and the editor in the same Vite bundle, the same `index.html`, and the same GitHub Pages deployment. The editor is desktop-only by design — same as the game.
