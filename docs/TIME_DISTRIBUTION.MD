# Time Distribution Data Path

This document describes how time-distribution data is computed for the Time category graphs.

## Source Data

- Revlog and card data are processed in [`src/ts/revlogGraphs.ts`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/revlogGraphs.ts).
- FSRS replay state is processed in [`src/ts/MemorisedBar.ts`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/MemorisedBar.ts).
- FSRS replay uses resolved card presets from `/_anki/fsrsPresetData` when available. Presets are requested only for cards present in the loaded revlogs.
- Deck FSRS presets are still read from `SSEother.deck_configs` and `SSEother.deck_config_ids` as the fallback path.
- Resolved preset parameters are used directly. Deck fallback parameters are selected with [`selectTsFsrsParams`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/fsrsParams.ts), which follows Anki's selected `fsrsVersion` first (FSRS7/6/5/4) and only falls back when that version's params are unusable.

## Loading Behavior

- Time Distribution, Time Totals, and Time by Repetitions require only revlog statistics.
- Time by Retrievability, Stability, and Difficulty require the replayed FSRS
  statistics returned by `getMemorisedDays()`.
- When automatic FSRS graph loading is disabled, those FSRS-dependent graphs
  show the standard calculation control. Starting it loads both revlogs and the
  FSRS replay before rendering the graph.

## Existing Time Graph Fields

- `revlog_times`: count of cards by total answer time bucket (seconds).

## New Time-by-FSRS Fields

The following arrays are returned by `getMemorisedDays()`:

- `time_by_retrievability_mean`
- `time_by_retrievability_median`
- `time_by_retrievability_mean_exclude_same_day`
- `time_by_retrievability_median_exclude_same_day`
- `time_by_retrievability_mean_success_only`
- `time_by_retrievability_median_success_only`
- `time_by_retrievability_mean_success_only_exclude_same_day`
- `time_by_retrievability_median_success_only_exclude_same_day`
- `time_by_stability_mean`
- `time_by_stability_median`
- `time_by_difficulty_mean`
- `time_by_difficulty_median`

### Semantics

- Buckets are built from per-review FSRS state immediately before applying the current rating.
- FSRS-7 uses upstream's complete slow/fast stability and difficulty state with fractional elapsed days. Older models preserve the collection-rollover calendar-day convention.
- Retrievability bucket: `floor(R * 100)` clamped to `0..99`.
- Stability bucket: `round(S)` in days, clamped to `>= 0`.
- Difficulty bucket: `round(D * 10) - 1` clamped to `0..99` (0.1-point buckets).
- Values stored in buckets are review times in seconds.
- Mean/median arrays represent answer-time statistics per bucket.

### Included Reviews

- Only rated reviews (`ease > 0`) are included.
- Cramming entries (`type == 3 && factor == 0`) are excluded.
- Reset entries clear replayed memory before the next rated review, but do not create samples.
- Retrievability graph UI defaults to excluding same-day reviews (`elapsed < 1`).
- Retrievability graph can optionally restrict to successful answers only (`ease > 1`, i.e. Hard/Good/Easy).

## Time-by-Repetition Semantics

- Repetition buckets are computed per card while iterating revlogs.
- Each rated review with time (`time > 0 && ease > 0`) increments that card's repetition counter.
- Bucket key is the repetition number (1 for first rated timed review, 2 for second, etc.).
- Values stored in buckets are review times in seconds.
- Mean/median arrays represent answer-time statistics per repetition bucket.

### Repetition Data Path

- Repetition arrays (`time_by_repetition_mean`, `time_by_repetition_median`) are returned by `calculateRevlogStats()` in `revlogGraphs.ts`.
