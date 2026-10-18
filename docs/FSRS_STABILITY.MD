# FSRS Stability Metrics

## Current Exposure × Stability matrix

The panel appears in Search Stats Extended's Lapse section after Lapse Load, Lapse Distribution and Lapse Total. It follows the section's visibility, category order and responsive graph layout. It uses the same current search and displays active studied cards with valid stored S90. New cards, suspended/buried cards and missing-S90 cards are excluded and reported. Reps are the current Anki card counter (`prop:reps`), not a fresh count of retained revlog entries.

The default exposure bands are reps <5, 5–30 inclusive, and >30. Stability bands are stored S90 <7 days, 7–30 inclusive, and >30. Four editable positive thresholds are persisted in the add-on configuration as `exposureStabilityThresholds` (`repsLower`, `repsUpper`, `s90Lower`, `s90Upper`). Rep thresholds must be whole numbers and each upper threshold must exceed its lower threshold. Invalid saved settings use the defaults.

The compact Unified layout shows card counts above workload values, with the threshold form and explanatory text initially collapsed. The final column sums each exposure row; the final row sums each stability column; the bottom-right cell is the grand total. The main-diagonal summary sums under-exposed/unstable, middle/middle and over-exposed/stable cells. All summaries preserve separate known-workload coverage, so cards with unavailable model state remain counted.

Each cell shows card count and estimated current maintenance workload. The interval is solved from each card's resolved FSRS preset and complete current memory state at its stored desired retention, falling back to the preset retention only when the stored value is absent or invalid. FSRS-7 passes `s_int`, `s_fast` and difficulty together. Workload is `sum(1 / max(curve_interval_days, 1))`, matching the existing daily minimum while replacing scheduled intervals with curve-derived intervals. It is not a simulated future review forecast and includes neither future learning gains nor repeated-failure/relearning costs.

Cards with valid S90 remain counted if workload cannot be computed; unavailable workload is shown separately rather than interpreted as zero. Threshold changes only regroup prepared values and do not replay review history or recompute the model intervals. Counts can display while shared preset data is still loading. An open Lapse section requests the existing shared current-preset data even when the separate Misc category is closed, without enabling historical review loading. A collapsed or removed Lapse section does not request that data for the matrix.

## Daily maturation and introductions

Daily maturation appears in the Introduced section. Its Calculate action loads the full available history for the current search and runs a dedicated FSRS worker calculation; it does not enable Memorised replay or calibration. The selected Stats date range limits the displayed dates, not the history needed to find lifetime first crossings.

Both milestones use the matrix's saved S90 cutoffs: Maturing is the first post-review S90 at or above `s90Lower`; Matured is the first S90 strictly above `s90Upper`, matching the matrix's inclusive middle band. Introduction is the first eligible initial learning review. Each card contributes once to each series across its entire retained history, including earlier learning cycles. Resets and later lapses do not create another introduction or milestone. An intra-day crossing still counts if a later answer lowers stability that day.

The three series share the same complete-history card population from the current search. Cards whose initial learning is missing, unsupported, or excluded by the preset's historical cutoff are excluded from all three series and reported. Native FSRS history selection excludes cram and manual entries and applies model-specific initialization and rollover rules. Full FSRS-7 slow/fast stability and difficulty are used to solve S90. This reconstruction uses current resolved preset parameters; unavailable historical parameter changes and deleted reviews cannot be recovered.

The ratios are `100 × Maturing(day) / Introduced(day)` and `100 × Matured(day) / Introduced(day)`. Zero introductions produce gaps, not zeros or infinity. These are same-day throughput ratios, which can exceed 100%; they do not measure the eventual maturation of the cards introduced on that date.

The worker returns only each card's introduction day and typed record-high S90/day pairs, then releases the loaded history. Changing either threshold recomputes the daily series from those compact peaks without replaying reviews again. This preserves exact boundary values and the first crossing within an Anki day.

This document describes how stability-related values are computed for FSRS graphs.

## Average Stability Over Time

- Source: [`getMemorisedDays()`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/MemorisedBar.ts)
- Output fields:
    - `day_means`
    - `day_medians`
    - `day_young_ratio_s90`

### Semantics

- `day_means` and `day_medians` are computed from `S90`, not raw FSRS `stability`.
- `S90` is defined as the interval in days where retrievability is `90%`.
- Historical replay computes S90 from the complete upstream model state after each review locally from the resolved preset params already read through `/_anki/fsrsPresetData`. For FSRS-7, the interval solver receives slow stability, fast stability, and difficulty together.
- This avoids an additional backend S90 conversion request while preserving Anki's dynamic preset overlay resolution for the FSRS params used in the conversion.
- Replay retains only each card's final S90 transition per Anki day, including reset events, then computes the same daily statistics from those transitions.
- Local FSRS-7 conversion evaluates the complete state immediately instead of retaining a collection-wide request/state cache. Older models retain the existing scalar stability buckets and cache the first interval in each preset/bucket. An injected batch resolver still deduplicates FSRS-7 requests by complete parameters and all three state values; numeric request indices represent the daily transitions.
- `day_young_ratio_s90` stores the young-card ratio based on `S90 < 21`.

### Notes

- Raw internal stability values are still used in places that need original
  FSRS state. Current card data reads those values from `card.data.s_int`, with
  fallback to `card.data.s` for older collections.
- This split avoids mixing display-oriented “stability over time” with raw state internals.
- For current persisted FSRS-7 card data, Anki stores `card.data.s` as S90, `card.data.s_int` as internal slow stability, and `card.data.s_fast` as internal fast stability.
- The Ease Factor graph reads current internal stability and difficulty from
  Anki, then passes that state to `ts-fsrs` to estimate the next Good-review
  stability gain. FSRS-7 additionally uses `s_fast`; its interval is solved from the complete state at the card's desired retention.
- FSRS-7 current-state graphs skip cards missing valid `s_int`, `s_fast`, or difficulty rather than inventing a fast trace or interpreting S90 as slow stability. Historical replay reconstructs its own state from the loaded review history.
- Older models accept Anki stability down to `0.0001` and raise it to the upstream model's `0.001` minimum before state updates. FSRS-7 supports the `0.0001` minimum directly.

## Average Stability Over Reps

- Source: [`getMemorisedDays()`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/MemorisedBar.ts)
- Output field:
    - `average_stability_by_reps`
    - `average_interval_by_reps`

### Semantics

- Cards are grouped by current `CardData.reps`, matching Anki's `prop:reps` value.
- The default stability view stores the mean current `S90` from `card.data.s`.
- The interval view stores the mean current positive `CardData.ivl`.
- Cards without a positive finite value for the selected metric are not included in that mean.

### Notes

- The stability view intentionally uses `S90`, not raw FSRS stability.
- It is a current card-data graph, not a replayed review-history graph.

## Historical Coverage

Historical average S90, median S90, and young-card ratio apply the final review
day's state updates and carry them through today. This also covers searches
with only one review day; the latest point must not disappear merely because
there is no subsequent review day.

## Daily FSRS snapshots and missing history

Daily Memorised predictions use the final scheduling-affecting state for each
Anki day. Historical snapshots are one millisecond before the following local
rollover; today's snapshot uses one timestamp captured when replay starts.
FSRS-7 evaluates fractional elapsed days from the actual retained review
timestamp. Older models retain their whole-Anki-day update policy. Local day
boundaries are constructed separately for each calendar date, including DST.

Replay resolves the full preset for each card, including historical retention
and the UTC-midnight "ignore reviews before" cutoff. A complete learning cycle
starts from its first learning grade. Incomplete cycles start with Anki's
interval/ease bridge using the first retained interday grade's **post-review**
interval. That grade is represented by the bridge and is not applied a second
time. FSRS-encoded factors restore difficulty; FSRS-7 scales both traces while
preserving their ratio. Cram and manual scheduling entries do not update the
state. Reset events close the previous state until another eligible grade.
Earlier learning cycles remain available for historical graphs.

The bridge is an estimate, matching native Anki's behavior; deleted history and
past preset changes cannot be reconstructed exactly. Preset/state deduplication
must include the complete parameter values, since cards sharing one preset id
can have distinct resolved overrides.
