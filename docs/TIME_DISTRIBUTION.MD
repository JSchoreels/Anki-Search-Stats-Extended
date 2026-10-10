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
- Each rated non-cramming review (`ease > 0`) increments that card's repetition counter, including reviews with zero answer time.
- Bucket key is the repetition number (1 for the first rated review, 2 for the second, etc.). Only positive answer times contribute time samples.
- Values stored in buckets are review times in seconds.
- Mean/median arrays represent answer-time statistics per repetition bucket.

### Repetition Data Path

- Repetition arrays (`time_by_repetition_mean`, `time_by_repetition_median`) are returned by `calculateRevlogStats()` in `revlogGraphs.ts`.

## Displayed Ranges

Time graphs retain exact review durations alongside the per-bucket mean/median
arrays in `TimeBuckets`: shared `Float64Array` duration values, `Uint32Array`
review indices grouped by bucket, and `Uint32Array` bucket offsets. The six FSRS
time series share one duration buffer, including their overlapping success and
same-day filters. Repetition times use the same compact representation.
`TimeBucketBuilder` collects numeric chunks and releases them after constructing
the grouped indices; it does not retain six arrays of duration copies. Workers
transfer these result buffers to the page once, preserving shared values. `BarScrollable.aggregateValues` combines those samples for
all buckets in each displayed bar before calculating its statistic. It never
averages bucket means or bucket medians. For example, 100 ten-second reviews
and one hundred-second review have a combined mean of 1100/101 seconds and a
median of ten seconds.

Changing the bar width, scroll, success filter, same-day filter, or mean/median
option recalculates those displayed statistics from the same selected samples.
Widths use whole source buckets. Retrievability series retain all 100 one-percent
buckets so sparse/highest-value data cannot shift the axis labels.
