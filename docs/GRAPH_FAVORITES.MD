# Favorite graphs

Every standalone Search Stats Extended graph card has a star button beside its
heading. Activate the star to move that card into **Favorite graphs**, above
Anki's built-in charts and below the native search and date-range controls.
Activate it again to return the card to its original category and position.
The empty Favorites section is hidden. Configuration, About, and the nested
Memorised diagnostic panel are not favorite graph cards. Native Anki graphs do
not gain star buttons.

Favorites follow the current Statistics search and date range, and retain their
usual Calculate and Retry actions. Moving a card preserves its live component,
controls, loaded data, and focused control; it does not create a second graph or
start an extra calculation. Graph controls keep their existing persistence rules:
pinning does not save temporary settings such as the daily moving-average window.

Favorite graphs remain accessible when their original category is collapsed or
hidden through Graph Order. Other graphs in that category stay hidden. Unpinning
a graph from a hidden category removes it from Favorites; expand or show the
category to access it again. Category reordering does not reorder Favorites.
Favorites appear in the order they were pinned; removing and pinning a graph
again places it last.

## Saved settings

`pinnedGraphs` is an ordered array in the add-on configuration, initially empty:

```json
{
    "pinnedGraphs": ["fsrs:daily-standardizedGap", "fsrs:daily-logLoss"]
}
```

IDs identify graph cards, independent of translated headings, selected models,
category order, search, and date range. Each ID has a category namespace followed
by a stable graph key. For example, both FSRS and RWKV views of Daily Surprise
share `fsrs:daily-logLoss`; the two daily metrics have separate IDs. Graph IDs
are persisted contracts and should stay stable when headings or layouts change.
New standalone graph cards need a unique `graphId`, forwarded through calculation
container wrappers when used. Settings and nested subpanels can omit it.

Missing settings use an empty list, and duplicate IDs are removed in memory.
Loading settings does not write them back. Star actions use the existing
`writeConfig` endpoint, with serialized writes so rapid actions on different
cards preserve the complete order. A card moves only after a successful save.
Failed saves preserve its previous state and show a retry message beside the
card's controls. No review history, card data, or collection database is changed.

## Layout and data ownership

`GraphContainer` moves the live card to the Favorites grid while retaining its
original location. The grid uses the same responsive columns as normal graph
categories. Its host is inserted before native `.graphs-container`, including
when Anki mounts that container after the add-on. Teardown removes relocated
cards and the Favorites host without touching native charts or controls.

A category with saved favorites remains mounted when hidden, but its unpinned
graph contents do not mount. Graph-specific automatic requests also follow
visibility: the Time Active matrix requests history only when that matrix is
visible or pinned; current disagreement/retrievability requests run when either
of those cards is visible or pinned. A pinned heatmap or ease-factor graph can
load the resolved presets it needs even when Misc is collapsed. A pinned review
speed graph does not request those presets. Existing explicit calculation gates
remain in place.

## Verification

`test/graphFavorites.test.ts` covers saved order, serialized writes, failed saves,
live-node and focus preservation, exact return positions, mount order, late native
mounting, and teardown. `test/memorisedDemand.test.ts` checks that restored
favorites load only the needed presets and do not write configuration or request
review history on startup. The Svelte UI smoke flow exercises pin/unpin on the
daily graphs, retained smoothing controls, category collapse/removal, saved pins,
failure/retry, and native-page-safe teardown.

Build with `npm run build`, package with `./package.sh`, and install with
`./copy_to_anki.sh`. Reopening Statistics loads frontend changes.
