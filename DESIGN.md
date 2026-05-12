# Mahjong-Style Word Solitaire — Design

Browser prototype. 2D card game inspired by mahjong solitaire. Reuses the category-card / simple-card mechanic from the Unity Word Solitaire project; replaces the 4-column board with a 3D layered board.

## Tech

- TypeScript + React (Vite).
- Plain DOM/CSS for rendering. Cards are HTML elements positioned with CSS transforms.
- Native HTML5 Drag-and-Drop API (`dnd-kit` if the native API gets clunky).
- Desktop only. No mobile / touch.

## Screen layout

Four vertically stacked containers, top to bottom:

1. Stock pile · Hand · Moves counter
2. Category slots (3–6 per level, configurable)
3. Game board (~3/5 of vertical height)
4. Rollback button

## Card types

- **Category card.** Identity = category id. Goes to empty slots; locks slot to its category.
- **Simple card.** Belongs to a category. Goes to occupied slots of matching category; consumed on placement.

No joker. No other special cards.

## Category slots

- 3–6 per level (`slotsDefault`).
- Empty slot accepts only category cards. Placement locks slot to that category.
- Occupied slot accepts only simple cards of matching category. Each placement consumes the card (slot increments its progress).
- When all simple cards of a slot's locked category are consumed, the slot auto-clears. It then becomes available to be locked to a different category.
- Multiple slots can be in-progress simultaneously, each on a different category.

## Board

### Coordinate system (half-tile grid)

Each card has integer position `(x, y, z)`:

- `x, y` — half-card units in the playfield. Even coords = aligned to the standard card grid; odd coords = naturally half-offset by half a card. **No `halfOffset` flag** — the offset is implicit in coordinate parity.
- `z` — explicit integer layer (0 = bottom).
- A card's footprint is the 2×2 block of half-tile cells anchored at its `(x, y)`.

### Coverage rule

A board slot's effective render layer is `top.z * 100 + (stackDepth - 1)`. This combines the base z layer with the stack position so a same-position-stacked card counts as visually higher than a same-z half-offset card.

Slot S1 is **covered** if any other slot S2 exists where `effectiveLayer(S2) > effectiveLayer(S1)` AND their 2×2 footprints overlap (any overlapping cell). Equivalent: any visually-higher card whose footprint touches mine covers me.

- Covered slots' top cards are hidden (face-down) and not interactable.
- Uncovered slots' top cards are revealed (face-up).
- Reveal status is recomputed on every move.

This means level designers should ensure same-z cards do not have overlapping footprints in awkward ways, since same-position stacking will render visually above any half-offset neighbor on the same z, hiding it.

### Side-blocking rule (Mahjong-style)

A revealed top card is only **interactive** (draggable, drop-target) if at least one of its 4 cardinal neighbours at the same z-layer is open:

- Slot S has top card at z = Z.
- Neighbours = slots at (S.x − 2, S.y), (S.x + 2, S.y), (S.x, S.y − 2), (S.x, S.y + 2).
- A neighbour *blocks* if it exists, is not dead, and contains a card at z = Z (whether or not that card is the slot's top).
- S is locked iff all 4 neighbours block. Otherwise S is free.

Locked cards stay face-up (you can read the word) but cannot be dragged or used as a drop target until at least one neighbour is removed. Visually they appear dimmed.

### Board slots and stacking

A "board slot" is one `(x, y)` position; it can hold a vertical stack of cards.

- Level data may declare multiple cards at the same `(x, y)` with different `z` — that's level-authored same-position stacking.
- At runtime, a successful Board → Board or any drop onto a board card appends to the destination slot's stack: new card's `z = current top z + 1`.
- Within a stack, only the top card is interactable, and only if the slot itself is uncovered per the overlap rule.
- Visual rendering: each card in a stack is drawn with a small constant offset so depth is visible.
- A slot's **floor z** is the lowest `z` of any card declared there in the level data.
- **Emptying a slot above the bottom floor (`floorZ > 0`) kills it permanently** — no further drops accepted there.
- **Emptying a bottom-floor slot (`floorZ === 0`) leaves it alive and placeable.** Any card (category or simple, from hand or another board top) can be dropped into the empty slot at `z = 0`, subject to the same overlap rule — the slot must not be covered by a higher-z overlapping neighbour. After placement the normal stacking and category-match rules apply.

## Stock and Hand

- **Stock.** Face-down ordered list of cards declared by the level.
- **Hand.** Holds at most 1 card.
- **Draw.** Top of stock → hand. If hand already holds a card, that card returns to the bottom of the stock first, then the new draw happens. When stock is empty, hand auto-returns to stock so drawing can resume. Costs 1 move.

## Legal moves

Each move costs 1 from `movesLimit` (unless noted).

| Move | From | To | Conditions |
|------|------|-----|-----------|
| Draw | Stock | Hand | — |
| HandToSlot | Hand | Category slot | Empty slot accepts only category card; occupied slot accepts only matching-category simple card |
| HandToBoard | Hand | Board (revealed top) | Same category; target must not be a category card |
| HandToBoard | Hand | Empty bottom-floor slot | Slot must be uncovered; any card accepted; lands at `z = 0` |
| BoardToSlot | Board (revealed top) | Category slot | Same slot rules |
| BoardToBoard | Board (revealed top) | Board (revealed top) | Same category; target must not be a category card |
| BoardToBoard | Board (revealed top) | Empty bottom-floor slot | Slot must be uncovered; any card accepted; lands at `z = 0` |
| ReturnHandToStock | Hand | Stock | Auto, when stock is empty (free, no move cost) |

No Board → Hand. Drops onto dead slots are rejected; empty bottom-floor slots accept drops as above, empty non-bottom-floor slots do not.

### Placement rule details (inherited from Word Solitaire)

- Onto another board card: target must be a non-category card; both cards must share category. A category card *can* be placed on a simple card of the same category.
- Into a category slot:
  - Empty slot → only category cards accepted (locks slot).
  - Occupied slot → only simple cards of matching category accepted (consumes them).

## Rollback

- One button, always free, never gated.
- Each click rolls back exactly one move.
- Tracks every move from the start of the level — full multi-step history.
- Can roll back all the way to the level's initial state.
- Disabled only when at the initial state.

## Win / loss

- **Win.** All simple cards in the level have been consumed.
- **Loss.** Moves counter reaches 0 before win.

## Levels

### File format

JSON, one file per level.

```json
{
  "levelId": "tutorial-1",
  "slotsDefault": 4,
  "movesLimit": 80,
  "categories": [
    {
      "categoryId": "Fruit",
      "wordsData": [
        { "wordId": "Apple" },
        { "wordId": "Banana" },
        { "wordId": "Cherry" },
        { "wordId": "Date" }
      ]
    }
  ],
  "stock": ["Apple", "Banana"],
  "board": [
    { "x": 0, "y": 0, "z": 0, "cardId": "Cherry" },
    { "x": 2, "y": 0, "z": 0, "cardId": "Date" },
    { "x": 0, "y": 2, "z": 0, "cardId": "Apple" },
    { "x": 2, "y": 2, "z": 0, "cardId": "Banana" },
    { "x": 1, "y": 1, "z": 1, "cardId": "Fruit" }
  ]
}
```

`cardId` references either a `categoryId` (becomes a category card) or a `wordId` from any category (becomes a simple card of that category). Convention is reused from the Unity project.

### Authoring

3 hand-authored levels for the prototype, each with a different shape (e.g. small pyramid, staggered slabs, custom shape). JSON edited by hand. No editor in scope.

## Out of scope (prototype)

- Joker mechanic
- Hint system
- Shuffle
- Daily levels
- Persistence / save state
- Mobile / touch
- Sound, music, polish animations
- Level editor
- Score / star rating
- Softlock / hardlock detection (rollback handles dead-ends)

## Open implementation details (non-blocking)

- Visual offset magnitude per stack level — tune in implementation.
- Auto-return cycle visual / sound cue — defer until the basic loop works.
- Category-slot count UI when slot count varies per level — confirm at first level beyond the default.
