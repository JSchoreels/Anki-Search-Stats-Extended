# Time Distribution Data Path

This document describes how time-distribution data is computed for the Time category graphs.

## Source Data

- Revlog and card data are processed in [`src/ts/revlogGraphs.ts`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/revlogGraphs.ts).
- Deck FSRS presets are read from `SSEother.deck_configs` and `SSEother.deck_config_ids`.
- FSRS parameters are selected with [`selectTsFsrsParams`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/fsrsParams.ts), which follows Anki's selected `fsrsVersion` first (FSRS7/6/5/4) and only falls back when that version's params are unusable.

## Existing Time Graph Fields

- `revlog_times`: count of cards by total answer time bucket (seconds).

## New Time-by-FSRS Fields

The following arrays are now returned by `calculateRevlogStats()`:

- `time_by_retrievability_mean`
- `time_by_retrievability_median`
- `time_by_stability_mean`
- `time_by_stability_median`

### Semantics

- Buckets are built from per-review FSRS state immediately before applying the current rating.
- Retrievability bucket: `floor(R * 100)` clamped to `0..99`.
- Stability bucket: `round(S)` in days, clamped to `>= 0`.
- Values stored in buckets are review times in seconds.
- Mean/median arrays represent answer-time statistics per bucket.

### Included Reviews

- Only rated reviews (`ease > 0`) are included.
- Cramming entries (`type == 3 && factor == 0`) are excluded.
- Reset entries update FSRS state via `forget`, but do not create samples.
