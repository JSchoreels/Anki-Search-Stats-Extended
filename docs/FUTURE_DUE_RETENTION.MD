# Future Due Retention Data Path

This document describes how the Future Due Retention graph reads card and deck data.

## Source Data

- Card records are read by [`getCardData()`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/search.ts).
- Graph buckets are computed in [`calculateCardDataPies()`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/CardDataPies.ts).
- The graph displays `target_R_days` in [`FutureDueCategory.svelte`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/categories/FutureDueCategory.svelte).

## FSRS Model Selection

For each review card with FSRS stability in `card.data.s`, the graph resolves the card's deck preset through:

1. `SSEother.deck_config_ids[card.odid || card.did]`
2. `SSEother.deck_configs[config_id]`
3. [`selectTsFsrsParams()`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/fsrsParams.ts)

`selectTsFsrsParams()` follows Anki's selected `fsrsVersion` first. When `fsrsVersion` selects FSRS7, the graph uses the 35-parameter FSRS7 model through `ts-fsrs`.

If deck config data is unavailable, the graph keeps the older per-card `card.data.decay` path.
