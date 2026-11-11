# Favorite graphs

Every standalone Search Stats Extended graph card has a star button and a Hide
button beside its heading. Activate the star to add that graph to **Favorite graphs**, above
Anki's built-in charts and below the native search and date-range controls.
The graph also remains in its original category and position while that category
is visible. Activate either star again to remove the top copy and keep the graph
in its category.
The empty Favorites section is hidden. Configuration, About, and the nested
Memorised diagnostic panel are not favorite graph cards. Native Anki graphs do
not gain star buttons.

Favorites follow the current Statistics search and date range, and retain their
usual Calculate and Retry actions. The existing live card moves to Favorites,
preserving its controls, loaded data and focused control; an additional interactive
copy appears in the category. Both use the current shared statistics data. Heavy
history replay and prediction requests owned outside the card stay shared.
Pin and Hide choices apply to both copies. Graph controls keep their existing
state ownership and persistence rules: child-local controls such as daily smoothing
and zoom can differ between copies, while controls backed by shared stores stay
shared. Pinning does not save temporary settings such as the daily moving-average
window. Unpinning retains the Favorites copy's live state when it returns home.

Favorite graphs remain accessible when their original category is collapsed or
hidden through Graph Order, unless the graph is individually hidden. Other graphs in that category stay hidden. Unpinning
a graph from a hidden category removes it from Favorites; expand or show the
category to access it again. Category reordering does not reorder Favorites.
Favorites appear in the order they were pinned; removing and pinning a graph
again places it last.

## Hidden graphs

**Hide** removes both copies of a graph from its category and Favorites.
**Show hidden graphs (N)** appears in Anki's bottom-right Statistics button row,
beside Save PDF and Export troubleshooting info. It temporarily
reveals the saved hidden cards together in a **Hidden graphs** section at the
bottom of the page, after the regular categories and About, including cards from
collapsed or removed categories. Use **Hide hidden
graphs (N)** to close that section without changing the saved choices.

Each revealed card has an **Unhide** button to restore it permanently. A hidden
favorite keeps its saved pin and returns to Favorites and its visible category
when restored. Other cards
return to their original category; expand or show that category when necessary.
Pinning a card while it is in Hidden graphs does not unhide it. Hidden status
takes priority over pinning until the card is restored.

The reveal toggle starts off on each Statistics visit and resets when the last
hidden card is restored. The bottom-right toggle disappears when no hidden cards remain.
Hiding a card unmounts its contents, following the same temporary-control rules
as collapsing a category; it does not add persistence for its local graph options.
Restoring a currently revealed card moves its live node and retains those controls.

`hiddenGraphs` is a saved array of the same stable graph IDs as `pinnedGraphs`,
initially empty. Hidden cards are shown in the order they were hidden. Loading
the saved list and toggling the temporary reveal mode do not write configuration.
Hide/Unhide actions serialize cumulative changes through `writeConfig`, and only
change the UI after successful saves. Failed writes keep the previous state and
display a retry message on the affected card. Pin and hidden preferences use the
shared `graphPreferences` helper, with independent saved lists.

## Saved settings

`pinnedGraphs` is an ordered array in the add-on configuration, initially empty:

```json
{
    "pinnedGraphs": ["fsrs:daily-standardizedGap", "fsrs:daily-logLoss"]
}
```

IDs identify graph cards, independent of translated headings, selected models,
category order, search, and date range. Each ID has a category namespace followed
by a stable graph key. For example, both FSRS and RWKV views of Daily Log Loss
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

`GraphContainer` uses `GraphCard` for the managed live card and, when pinned and
its category is visible, an additional category copy. The managed card moves to
the Favorites or revealed-hidden grid while retaining its original location.
Each SVG is owned by its rendering child, including `GraphSvg` for inline
current-prediction graphs, so both copies redraw correctly. The grids use the same responsive columns as normal graph
categories. Its host is inserted before native `.graphs-container`, including
when Anki mounts that container after the add-on. Teardown removes relocated
cards and the Favorites host without touching native charts or controls.
`HiddenGraphs` owns the bottom grid. `graphVisibilityButton` publishes its count,
localized toggle label and reveal state to `graph_controls.py` through the
`sseHiddenGraphsState:` bridge command. The native checkable ActionRole button
calls the current view's `toggleSseHiddenGraphs` function. It is disabled while
Statistics reloads and re-enabled when the current webview publishes its state.
Repeated dialog-show hooks do not add another button. These commands only affect
the current view; they do not write configuration or access collection data.

A category with visible favorites or revealed hidden graphs remains mounted even
when collapsed or removed, but its other hidden graph contents do not mount.
Graph-specific automatic requests also follow
visibility: the Time Active matrix requests history only when that matrix is
visible or pinned; current disagreement/retrievability requests run when either
of those cards is visible or pinned. A pinned heatmap or ease-factor graph can
load the resolved presets it needs even when Misc is collapsed. A pinned review
speed graph does not request those presets. Individually hidden cards do not
activate these requests until revealed; hiding also overrides a saved pin.
Existing explicit calculation gates
remain in place.

## Verification

`test/graphFavorites.test.ts` and `test/hiddenGraphs.test.ts` cover saved order, serialized writes, failed saves,
live-node and focus preservation, exact return positions, mount order, late native
mounting, and teardown. `test/memorisedDemand.test.ts` checks that restored
favorites load only the needed presets, honor individual hiding, and do not write
configuration or request review history on startup. The Svelte UI smoke flow
exercises Hide, temporary reveal, Unhide, Favorites precedence, collapsed/removed
categories, saved hidden choices, failure/retry, retained restored controls, and
native-page-safe teardown. The updated layout smoke flow checks both favorite
copies, Hide/Unhide from either location, the footer toggle and bottom section,
both inline current-prediction SVGs, shared prediction loading, and radio state.
`test/graphControlsPython.test.ts` checks the native button with synthetic Qt
objects; `test/graphVisibilityButton.test.ts` checks the webview bridge lifecycle.

Build with `npm run build`, package with `./package.sh`, and install with
`./copy_to_anki.sh`. Fully quit and reopen Anki after installing the native button
change, then open Statistics. Later frontend-only changes only require reopening
Statistics.
