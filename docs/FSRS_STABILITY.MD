# FSRS Stability Metrics

## Current Exposure × Stability matrix

The panel appears in Search Stats Extended's Lapse section after Lapse Load, Lapse Distribution and Lapse Total. It follows the section's visibility, category order and responsive graph layout. It uses the same current search and displays active studied cards with valid stored S90. New cards, suspended/buried cards and missing-S90 cards are excluded and reported. Reps are the current Anki card counter (`prop:reps`), not a fresh count of retained revlog entries.

The default exposure bands are reps <5, 5–30 inclusive, and >30. Stability bands are stored S90 <7 days, 7–30 inclusive, and >30. Four editable positive thresholds are persisted in the add-on configuration as `exposureStabilityThresholds` (`repsLower`, `repsUpper`, `s90Lower`, `s90Upper`). Rep thresholds must be whole numbers and each upper threshold must exceed its lower threshold. Invalid saved settings use the defaults.

The compact Unified layout shows card counts above workload values, with the threshold form and explanatory text initially collapsed. The final column sums each exposure row; the final row sums each stability column; the bottom-right cell is the grand total. The main-diagonal summary sums under-exposed/unstable, middle/middle and over-exposed/stable cells.

Cell backgrounds use fixed category colors rather than workload intensity. With exposure on rows and stability on columns (low to high), the colors are green/green/orange for under-exposed cards, yellow/green/yellow for middle exposure, and red/yellow/green for over-exposed cards. Totals stay neutral. Colors follow the configured bands when thresholds change.

Every numeric cell is a button that opens the associated cards in Anki's Browser, scoped to the current Statistics search. Queries use `prop:reps` for exposure rows and `prop:s` for S90 columns, with strict `<`/`>` outer bands and inclusive `>=`/`<=` middle bands at the applied thresholds. They exclude new, suspended and buried cards and require positive reps and S90. Row and column totals omit the other axis's band limits; the grand total opens all eligible cards in the current search. Buttons support mouse, Enter and Space activation.

Each cell shows card count and scheduled daily load: `sum(1 / max(card.ivl, 1))`, using the stored scheduled interval in days. This is the same formula as native Future Due's Daily load. Totals match when both panels cover the same cards; native Daily load also includes buried cards and cards without usable S90, whereas the matrix needs positive reps and S90 and excludes all inactive queues. The matrix displays two decimal places; native Daily load truncates to a whole number. This summarizes existing intervals rather than simulating future learning or failures.

Workload does not depend on FSRS parameters, desired retention, or complete fast/slow memory state. Stored S90 is used only to group cards into stability columns. Threshold changes only regroup prepared values and do not replay review history or recalculate intervals. The matrix loads counts and workload together from card data and does not request shared preset data or historical reviews.

## Time Active × Average R matrix

Immediately after Exposure × Stability in the Lapse section, this matrix replays full retained history for currently active studied cards. Time Active is the inclusive number of calendar Anki days from the first actual initial-learning review to today's Anki day (same-day introduction is one day). Past suspended periods remain included because suspension events are unavailable. New cards and inactive queues are excluded and counted separately from incomplete histories or unavailable presets.

Average R is the arithmetic mean of one retrievability sample per included Anki day. Past samples use one millisecond before the following local rollover, constructed per calendar date including DST. Today's partial-day sample uses a single timestamp captured when calculation starts. The final scheduling state of the day includes all eligible reviews up to that timestamp. Complete slow/fast stability and difficulty are replayed using the card's current native resolved preset; FSRS-7 uses fractional elapsed time, older models use their whole-Anki-day policy. Manual/cram rows do not update state. Future rows are removed before history selection. A reset removes state until the next eligible grade; if any daily sample lacks state, or any cycle needs an incomplete-history bridge, the card is excluded rather than assigned a fabricated lifetime average. Missing initial learning, preset cutoffs that remove introduction, and missing presets also exclude the card. Deleted reviews and past parameter changes cannot be recovered.

Defaults are 30 / 180 days and 80% / 90% Average R. Positive whole-day thresholds and R percentages in (0, 100] are saved as `activeRetrievabilityThresholds` (`daysLower`, `daysUpper`, `rLower`, `rUpper`); each upper value must exceed its lower value. Invalid saved settings use defaults. Both axes ascend, with inclusive middle bands. Cell colors and neutral totals match Exposure × Stability. Each cell and row/column/grand/diagonal total shows count plus stored-interval workload `sum(1 / max(card.ivl, 1))`, and opens exactly its cached card IDs through the current-search Browser bridge. Empty cells use `cid:0`.

The visible matrix requests full history and resolved presets automatically, independently of Memorised/calibration. Its worker computes per-card metrics once and releases history. Threshold changes only regroup these cached values. Search changes, hiding the category when this matrix is not pinned in Favorites, individually hiding this matrix, and closing the view cancel obsolete requests and dispose history. A pinned matrix remains visible and calculated when its category is hidden, unless individually hidden. Show hidden graphs reactivates a hidden matrix while it is revealed. Pinning another Lapse graph does not activate this matrix. The Statistics date range does not limit this lifetime calculation.

## Daily maturation and introductions

Daily maturation appears as two separate graph cards in the Introduced section: daily counts and milestone/new ratios. Both use the configured full graph height (`barHeight`, default 250), share one history calculation, and resize to the available card width. Their Calculate action loads the full available history for the current search and runs a dedicated FSRS worker calculation; it does not enable Memorised replay or calibration. The selected Stats date range limits the displayed dates, not the history needed to find lifetime first crossings.

Both milestones use the matrix's saved S90 cutoffs: Maturing is the first post-review S90 at or above `s90Lower`; Matured is the first S90 strictly above `s90Upper`, matching the matrix's inclusive middle band. Introduction is the first eligible initial learning review. Each card contributes once to each series across its entire retained history, including earlier learning cycles. Resets and later lapses do not create another introduction or milestone. An intra-day crossing still counts if a later answer lowers stability that day.

The three series share the same complete-history card population from the current search. Cards whose initial learning is missing, unsupported, or excluded by the preset's historical cutoff are excluded from all three series and reported. Native FSRS history selection excludes cram and manual entries and applies model-specific initialization and rollover rules. Full FSRS-7 slow/fast stability and difficulty are used to solve S90. This reconstruction uses current resolved preset parameters; unavailable historical parameter changes and deleted reviews cannot be recovered.

The ratios are `100 × Maturing(day) / Introduced(day)` and `100 × Matured(day) / Introduced(day)`. Zero introductions produce gaps, not zeros or infinity. These are same-day throughput ratios, which can exceed 100%; they do not measure the eventual maturation of the cards introduced on that date.

Each graph defaults to a P90 vertical-axis ceiling and has an independent integer percentile control from P1 to P100. The ceiling is the selected interpolated percentile of the highest finite series value on each visible day, using only selected curves, with a minimum ceiling of 1. All-missing days are excluded; valid zero days remain included. P100 restores the full range. Clipping affects drawing only: values above the ceiling remain in the data, original tooltips and trend calculations. Curve and trend layers are clipped to the plot rectangle, while axes and legends remain visible.

Each graph has an independent checkbox for each curve, initially all selected. Hidden curves are removed from the plot, legend, tooltips, trends, and percentile ceiling. Deselecting every curve shows a selection prompt until a curve is enabled again. The choices remain in place when smoothing or its window changes.

An optional trailing moving average replaces the daily curves when enabled, using the same category colors. The legend and tooltips identify the averaging window. Disabling it restores the selected daily curves. The count and ratio graphs share its enable state and positive whole-day window (initially disabled, with a seven-day window ready to enable). Counts average daily values including zero days; the initial partial window divides by its available calendar days. Ratios divide the rolling milestone total by the rolling introduction total, rather than averaging individual daily percentages. A window without introductions produces a gap. Smoothing uses available history before the displayed date range, then the percentile ceiling is calculated from the selected daily or averaged curves. Percentile controls are local to each graph, and averaging state is shared for the current Statistics view; neither alters review history or replay parameters.

The worker returns only each card's introduction day and typed record-high S90/day pairs, then releases the loaded history. Changing either threshold recomputes the daily series from those compact peaks without replaying reviews again. This preserves exact boundary values and the first crossing within an Anki day.

This document describes how stability-related values are computed for FSRS graphs.

## Average Stability Over Time

Daily maturation and Average Stability Over Time support local
[drag-to-zoom](TIME_AXIS_ZOOM.MD). Maturation retains its percentile control
and calculates smoothing from the full prepared history before cropping.

Stability Over Time shows the selected daily mean or median as a line and keeps
the existing date-based trend ranges. A seven-calendar-day moving average is
enabled initially; its values are the equally weighted mean of the available
daily snapshots, including days without reviews. The faint grey line and hover
details retain the original daily value. The tooltip also shows the young and
mature shares for that day. Optional connectors only bridge gaps visually.
Turning smoothing off restores the daily line. A review-count window is not
offered because these values describe whole-collection daily snapshots rather
than individual reviews.

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

The Difficulty Over Time graph uses the exact mean or median replayed FSRS difficulty for each day. It follows the same resolved presets, history cutoff, and reset handling as the stability replay. Days without reconstructed card states have no value.

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

### RWKV source

The graph has an FSRS / RWKV / Both source selector (FSRS by default; the
FSRS view is unchanged). RWKV draws the RWKV median or mean as the only line,
with its own trend persistence key
(`fsrs:average-stability-over-time:rwkv`). Both draws FSRS as the primary line
(legend "FSRS") and RWKV as a comparison (legend "RWKV"); the RWKV moving
average uses the same window, mode, and gap connectors, its faint grey daily
line is dashed, and trends stay on the FSRS line and key. The Median/Mean
choice applies to both sources. The tooltip's young/mature shares follow the
selected source; Both lists each source's shares, prefixed with its name.

The RWKV replay starts once Memorised has been requested and RWKV or Both is
selected. Switching between RWKV and Both keeps the running replay; selecting
FSRS or changing the search cancels an unfinished one. A progress bar counts replayed history
entries and can cancel the replay; the RWKV line grows while it runs.

- Endpoints, polled every 500 ms by `rwkvStabilityStats` in
  [`stores.ts`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/stores.ts):
    - `/_anki/startRwkvStabilityHistory` with `{"cids": [...]}`
    - `/_anki/rwkvStabilityHistoryProgress` with `{"job_id": n}`
    - `/_anki/cancelRwkvStabilityHistory` with `{"job_id": n}`
- Progress fields: `medianByDay`, `meanByDay`, `youngRatioByDay`, and
  `cardCountByDay`, starting at RWKV scheduler day `firstDay`.
- Backend: `rwkv_stability.py`.

Semantics:

- The anchor is each card's last graded answer of an Anki day. At that day's
  end, the replayed RWKV-Instant state predicts the card's recall at a frozen
  grid of later day ends, k = 0…3650 days after the anchor day, each queried
  one second before the rollover and assuming no further reviews.
- RWKV's prediction for a card also depends on later reviews of other cards,
  so the frozen curve is usually optimistic. For each horizon, the drift is
  the median logit gap live − frozen over all cards, where live is the same
  query asked of the replayed state at that later day end while the card has
  not been answered again. The median comes from a histogram, is refitted
  every 30 days from pairs already in the past, and is capped at ≤ 0, so the
  correction can only lower recall. Between horizons it is interpolated in
  ln k and held beyond 365 days.
- S90 is the first downward crossing of 90% by the corrected curve,
  interpolated in log time since the answer. When the grid misses the
  crossing, S90 is extrapolated through the first or last point on
  R = (1 + f·t/S)^(−0.1542), with f fixed so that R(S) = 90%. S90 is clamped
  to [1 second, 3,650 days], the end of the query grid: a longer S90 would be
  extrapolated from a single point. RWKV-Instant can predict above 90% recall
  for years on some cards (6% of cards on the developer's collection were at
  the cap), so the mean depends on that cap while the median does not.
- Daily statistics over the selected cards are the median, the mean, and the
  young ratio (`S90 < 21` days, as for FSRS). A card keeps its RWKV S90 until
  its next graded answer, so resets do not clear it, and the last day is
  carried through today.
- Results are kept in memory for the Anki session, not cached to disk. The
  replay waits while an RWKV Memorised replay or another heavy RWKV replay is
  running.

### Validation

On the developer's collection (207,636 reviews, 2026-07 snapshot), frozen
predictions over-predicted the next answer's pass rate by 2.9 percentage
points; the capped correction by 0.0. Log loss was 0.460 frozen, 0.455
corrected, and 0.447 with full context. Answers at 0.8–1.25× S90 passed 87.4%
of the time with frozen S90 and 89.5% with corrected S90.

On the same collection the RWKV line swings more than FSRS, and not because
of the correction: the uncorrected median has the same swings. RWKV-Instant's
predictions for all cards follow recent results. For the 4,037 cards answered
by January 2025, the median S90 went from 12 to 31 days in April 2025 while
that month's pass rate rose from 86% to 91%. Waves of new cards, which start
with short S90s, pull the all-card median down (October–November 2024,
December 2025 onward). S90s range from under a day (up to 40% of cards) to the
10-year cap, so the median moves quickly when the mix changes.

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
