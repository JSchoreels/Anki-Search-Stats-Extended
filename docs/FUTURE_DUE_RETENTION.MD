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

`selectTsFsrsParams()` follows Anki's selected `fsrsVersion` first. When `fsrsVersion` selects FSRS7, the graph uses the 34-parameter FSRS7 model through `ts-fsrs`.

For FSRS-7, the curve receives the card's stored `s_int` (slow stability), `s_fast` (fast stability), and `d` (difficulty). `s` remains the display S90. Cards missing any required FSRS-7 state field are omitted from the retention sum; the graph does not fabricate a trace.

If deck config data is unavailable, the graph keeps the older per-card `card.data.decay` path for cards without a fast trace. A card with `s_fast` requires its preset weights and cannot use the decay-only fallback.

## Eligible Totals and Dates

Each day stores both a prediction sum (`target_R_days`) and the count of cards
that contributed that sum (`target_R_day_totals`). Review cards need a positive
queue, interval, and usable model state. Missing-state, learning, and relearning
cards cannot enlarge the denominator. A widened bar combines these sums and
counts before computing its retention ratio.

Filtered cards use their original due date (`odue` when present). Calendar-day
due numbers are relative to the collection's elapsed days; Unix due timestamps
are seconds and are converted to a whole collection day before grouping.
