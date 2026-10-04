# FSRS Calibration Graph Data Path

This document describes how calibration graph data is read for graph computations,
including Anki's add-on preset overlay data and the optional RWKV calibration
source.

## Source Data

- Deck config data is read from Anki in [`__init__.py`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/__init__.py) through:
    - `mw.col.decks.all_config()`
    - injected as `SSEother.deck_configs`
- Card-specific FSRS preset data is read from Anki through the `/_anki/fsrsPresetData` endpoint in [`__init__.py`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/__init__.py).
    - The frontend requests presets only for card ids present in the loaded revlogs, because Calibration/Memorised replay does not use cards without matching review history.
    - The endpoint calls `mw.col.fsrs_preset_for_card(card_id)`, so it uses the same dynamic preset overlay resolution as the Anki fork.
    - The returned preset includes `params`, `desiredRetention`, `historicalRetention`, and Dynamic Desired Retention calibration fields.
- Optional RWKV review retrievability data is read from Anki through the
  `/_anki/rwkvReviewRetrievability` endpoint in
  [`__init__.py`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/__init__.py).
    - The endpoint is called automatically for the FSRS-vs-RWKV UM+ comparison.
      The calibration source selector controls the ordinary calibration graph's
      display and does not gate UM+ data loading.
    - The frontend sends the exact `revlog.id` values used by the calibration
      samples, so RWKV persisted-value checks are limited to reviews that can
      affect the graph.
    - It first reads the add-on-owned
      `search_stats_rwkv_review_retrievability` cache table for those reviews.
      On adapted Anki builds, this table lives in the attached
      `retrievability_cache` sidecar database, so it is not included in
      collection sync/full upload.
      In role-aware tables, it returns only `test_fold` and
      `post_optimization` rows; calibration `final_fit` rows suppress older
      held-out rows for reviews that have since moved into the training split.
    - When a role-aware table is present, those held-out/cache rows are treated
      as the complete graph sample. Training rows intentionally do not produce
      "missing cache" warnings.
    - In legacy collections without role-aware cache columns, if no cached
      value is available, it looks for a whitelisted `revlog` column containing
      the RWKV retrievability at review time.
    - Explicit sample IDs are filtered to RWKV-answer rows (`ease` 1-4 and
      `revlog.type` 0-4). Rescheduled rows do not have RWKV review-time
      retrievability. With a role-aware table, skipped rows are silent because
      the held-out cache rows define the graph sample.
    - When no role-aware RWKV calibration rows are available, the add-on calls
      Anki's `aqt.rwkv_scheduler.ensure_rwkv_calibration_data(mw)` API when that
      API exists, then retries the cache read. The API is a no-op when current
      data is already complete and otherwise runs Anki's calibration-only
      historical replay while preserving active reviewer state.
    - Older Anki versions without the API retain the legacy read-only fallback:
      incomplete persisted values return no RWKV calibration data.
    - Expected values are probabilities in the `[0, 1]` range keyed by
      `revlog.id`.
- FSRS review retrievability data is read from Anki through the
  `/_anki/fsrsReviewRetrievability` endpoint when role-aware calibration cache
  rows are available.
    - The frontend sends the exact `revlog.id` values used by the calibration
      samples.
    - The endpoint reads `search_stats_fsrs_review_retrievability`, chooses the
      newest cache row for each review across `validation_fold`,
      `post_optimization`, and suppressing `final_fit` rows, then returns only
      `validation_fold` and `post_optimization` predictions.
    - If no role-aware rows are available, FSRS mode falls back to the browser
      replay used by `getMemorisedDays()`.

## Persistent Prediction Cache

Calibration caches store raw review-time predictions keyed by `revlog.id`, not
pre-binned graph data. This keeps the persisted data reusable across search
queries, date ranges, and future graph variants.

The add-on can create these tables lazily when running without a core
producer, but the Anki fork may also create and populate them during FSRS
optimization and RWKV state-cache builds. On adapted Anki builds, Anki attaches
`collection.retrievability-cache.sqlite` as `retrievability_cache`, and the
add-on creates/writes these tables in that sidecar instead of the synced
collection DB. Older Anki builds without the attached database fall back to the
main collection DB:

1. `search_stats_fsrs_review_retrievability`
2. `search_stats_rwkv_review_retrievability`

`search_stats_fsrs_review_retrievability` is role-aware:

- `revlog_id`: integer matching `revlog.id`
- `prediction`: probability in the `[0, 1]` range
- `source`: short string describing the writer, such as `fsrs_optimization` or
  `fsrs_review`
- `updated_at`: millisecond timestamp when the row was written
- `sample_role`: `final_fit`, `validation_fold`, or `post_optimization`
- `fold_index`: zero-based validation fold, or `-1` outside validation rows

Rows are uniquely keyed by `revlog_id`, `sample_role`, `fold_index`, and
`source`. `final_fit` rows intentionally suppress older post-optimization rows
when a later optimization has trained on that review.

`search_stats_rwkv_review_retrievability` is also role-aware:

- `revlog_id`: integer matching `revlog.id`
- `prediction`: probability in the `[0, 1]` range
- `source`: short string describing the writer, such as
  `rwkv_state_cache_build`
- `updated_at`: millisecond timestamp when the row was written
- `sample_role`: `final_fit`, `test_fold`, `validation_fold`, or
  `post_optimization`
- `fold_index`: zero-based test fold, or `-1` outside held-out rows

Rows are uniquely keyed by `revlog_id`, `sample_role`, `fold_index`, and
`source`. For RWKV calibration graphs, `final_fit` rows are ignored except when
they come from RWKV calibration training/recompute, where they suppress older
held-out rows that have since become training samples. Regular RWKV state-cache
build rows do not suppress held-out graph rows.

Anki-side producers should store pre-answer predictions for the same
`revlog.id`. The stats graph will use those rows before falling back to legacy
`revlog` columns. Current producers are:

- FSRS optimization writes `search_stats_fsrs_review_retrievability` with source
  `fsrs_optimization`, including `final_fit` and `validation_fold` rows.
- FSRS answer handling writes `search_stats_fsrs_review_retrievability` with
  source `fsrs_review` and role `post_optimization`.
- RWKV state-cache build/update maintains recurrent review state without
  generating historical calibration rows.
- RWKV calibration training/recompute writes
  `search_stats_rwkv_review_retrievability` with sources
  `rwkv_calibration_train` or `rwkv_calibration_recompute`, role `final_fit`
  for the chronological training split, and role `test_fold` for held-out
  calibration graph samples.
- RWKV answer handling writes `search_stats_rwkv_review_retrievability` with
  source `rwkv_review` and role `post_optimization`.

## Parameter Selection Used By Graphs

- Shared selector: [`src/ts/fsrsParams.ts`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/fsrsParams.ts)
- Used by:
    - [`src/ts/MemorisedBar.ts`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/MemorisedBar.ts)
    - [`src/ts/revlogGraphs.ts`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/revlogGraphs.ts)

For FSRS Calibration, retrievability is replayed per card in
[`getMemorisedDays()`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/MemorisedBar.ts).
When Anki returns a resolved preset for the card, that preset is used directly.
This covers FSRS Dynamic Preset Selection rules from Anki's `fsrsPresetOverlay`.
If no resolved preset is provided, the graph resolves the deck config from each
card's own deck id, or `odid` for filtered-deck cards.

The selected `fsrsVersion` is used first when its parameters are usable. Otherwise, deck-config fallback selection order is:

1. `fsrsParams7`
2. `fsrsParams6`
3. `fsrsParams5`
4. `fsrsParams4`
5. `fsrsWeights`
6. `ts-fsrs` default parameters

Accepted parameter lengths are `17`, `19`, `21`, `34`, and the persisted legacy preview layout `35`.

Dynamic Desired Retention fields are carried with resolved presets so the graph
data path stays aligned with Anki's current preset shape. Calibration and
Memorised retrievability predictions use FSRS params and memory state; desired
retention does not directly enter the model's retrievability calculation.

## Calibration Source Toggle

FSRS is the default calibration source. FSRS mode first uses role-aware cached
FSRS retrievability for each eligible review, preferring historical validation
and post-optimization samples over replayed in-sample values. If no cached FSRS
calibration rows exist yet, it falls back to the existing replayed FSRS
retrievability value for each eligible review.

RWKV mode reuses the same eligible review samples identified by
[`getMemorisedDays()`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/MemorisedBar.ts),
then requests RWKV probabilities for those sample `revlog.id` values from
`/_anki/rwkvReviewRetrievability`. With a role-aware RWKV cache table, the graph
uses the sparse held-out rows returned by that endpoint; train/final-fit rows
are intentionally excluded. On the first cache miss, adapted Anki builds may
run one calibration-only RWKV replay through the public ensure API. Later graph
loads reuse the persisted result, and active reviewer state is restored after
generation.

Both mode overlays the FSRS and RWKV calibration lines on the same graph. The
FSRS line is blue, the RWKV line is green, and the perfect-calibration reference
line remains orange. Review-count volume bars use the same source colors and
overlap in combined mode.

## FSRS vs RWKV current Disagreement

The **FSRS vs RWKV current Disagreement** histogram compares current
card retrievability rather than review-time predictions. It uses the cards in
the current statistics search, independently of the review date range and
historical Memorised calculation. Each card with both valid current probabilities
belongs to one bucket, rounded to the nearest 5 percentage points of
`FSRS R - RWKV R` (41 possible centers from -100% to +100%). As in UM+, exact
halfway values round toward the higher center. All populated buckets are shown;
there is no minimum card count. Bars show card counts, with bounds in their
tooltips. Lower bounds are inclusive and upper bounds exclusive, except +100%.

Clicking a bucket opens the browser in Cards mode, searches its exact card IDs,
and selects all results after saving any pending browser edit. Keyboard users
can focus a bar and press Enter or Space. Missing scores are excluded, and the
chart reports paired cards out of all cards in the search.

`/_anki/currentCardDisagreement` returns a transient snapshot. The add-on's
`current_disagreement.py` adapter uses the adapted Anki scheduler's guarded,
batched current RWKV statistics scoring path and the Collection API
`card_memory_metrics(..., include_retrievability=True)`. The backend computes R
from the complete stored memory state, resolved preset and fractional elapsed
days, using the same curve as Anki's native Card Retrievability chart. For FSRS-7,
this includes slow and fast stability and the card's difficulty. The scalar
`fsrs_current_retrievability()` compatibility helper assumes equal stability
traces and difficulty 5, so it must not be used for these current-card charts.
Cards without a valid backend FSRS R or RWKV R are excluded; the backend resolves
missing last-review timestamps from review history without updating cards.
Builds without the full-state metrics API show an unavailable message.
It adds no persisted cache or direct database operations. The RWKV
adapter requires the scheduler's state-token and search-score helpers; builds
without those capabilities show an unavailable message. Pending warm-up is
polled, errors offer Retry, and results from an obsolete search are discarded.

Package with `npm run build` followed by `./package.sh`; `./copy_to_anki.sh`
installs that archive into `addons21/1339555413`, preserving Anki-owned metadata,
configuration and user files. Fully quit and reopen Anki after Python changes.

## FSRS vs RWKV Card Retrievability

The **FSRS vs RWKV Card Retrievability** histogram immediately follows current
Disagreement and shares its transient prediction snapshot, loading state, retry,
search scope, and paired-card eligibility. It makes no additional prediction
requests and introduces no persisted data or database operations.

Anki's native Card Retrievability graph counts each model's available predictions
independently. This comparison includes only cards with valid predictions from
both models, so per-model counts can be lower here. For the same cards and
snapshot time, FSRS uses the native graph's full-state curve; a difference due to
missing paired predictions is distinct from using a different calculation.

**Group cards by: FSRS / RWKV** chooses which model determines each card's bar.
FSRS is selected initially. Each eligible paired card appears exactly once,
so the bar counts add up to the compared-card total. Switching models moves cards
between bars without changing that total. Like Anki's Card Retrievability chart,
it uses 20 fixed 5-percentage-point intervals from 0% to 100%. Lower bounds are
inclusive and upper bounds exclusive, except the final interval includes 100%.
Percentage conversion uses Anki's float32 rounding before binning, so values
such as the float32 representation of 95% (`0.949999988`) enter 95–100%, matching
the native graph rather than slipping into the previous interval.
The horizontal axis names the selected model and its **chance of remembering
today**.

With shift coloring off, each bar has at most two sections:

- Grey: both models assign the card to this interval, even if their exact
  predictions differ.
- Blue when grouping by FSRS: FSRS assigns the card here, while RWKV assigns it
  to another interval.
- Green when grouping by RWKV: RWKV assigns the card here, while FSRS assigns it
  to another interval.

Only the selected model's disagreement color appears in the legend. Clicking a
colored segment, or activating it with Enter or Space, browses and selects only
the exact cards represented by that segment.

The **Color by how far RWKV moves each card** toggle colors cards by the signed
difference `RWKV bucket index - FSRS bucket index`, independently of the grouping
model. Green means RWKV assigns a higher bucket, red a lower bucket, and grey
the same bucket. Saturation increases through five shades for shifts of 1 to 5
buckets; larger shifts keep the strongest shade. Each bar sorts its segments by
signed shift from bottom to top, placing grey between the red and green sections.
The legend uses separate rows for lower predictions, the same range, and higher
predictions. Labels describe direction in words, such as **2 steps lower** or
**Same range**, instead of signed differences. The endpoints read **5+ steps
lower** and **5+ steps higher**. A bulleted guide explains the selected grouping
model, colors, stronger shades, a one-step example (70–75% to 75–80%), and card
counting.

Segments remain grouped by exact shift, so tooltips report the actual move (up
to 19 steps higher or lower) and clicking selects only that group's cards.
Multiline tooltips also list counts for all eleven color levels (including
zeros), total cards, and the total where RWKV assigns a higher bucket than FSRS.
Each summary row explicitly labels counts **in this bar** and **overall**.
Local counts use the selected model's assignments and match the stacked bar;
overall means all eligible paired cards in the search, counting each card once.
Switching the grouping model updates local counts but leaves overall shift
counts unchanged. Toggling shift coloring changes neither bar totals nor card
positions. Both controls are local to this chart; they do not persist settings
or request new predictions.

The Card Retrievability comparison is followed by **RWKV Daily Recall Gap** and
**RWKV Daily Surprise**. These reuse eligible RWKV review predictions without
requiring paired FSRS predictions. Their calculations, daily grouping, and
interpretation are documented in [Daily RWKV surprise](RWKV_DAILY_SURPRISE.MD).

## FSRS vs RWKV UM+

The UM+ graph follows the calibration graph and automatically loads the same raw,
review-time FSRS and RWKV predictions. It is independent of the calibration
source selector, so it can load while the ordinary calibration graph displays
FSRS, RWKV, or Both. When current RWKV calibration data is absent, opening the
statistics page may therefore trigger the supported RWKV calibration-data
generation path described above.

Only review ids with eligible predictions from both models are included. Reviews
are grouped into 41 fixed bins by signed prediction disagreement:

`FSRS p(recall) - RWKV p(recall)`

Buckets with fewer than 200 paired reviews are hidden by default. The **Show
Small Buckets (<200 reviews)** toggle reveals them. Any line segment touching a
small bucket is dotted and less opaque; its points and volume bar are also less
opaque. The displayed UM+ scores continue to use every eligible bucket, including
small hidden buckets. Bubble percentages also remain relative to the full paired
sample.

The x-axis is limited to the remaining visible disagreement range. Its lower
bound is rounded down and its upper bound rounded up to the next 10 percentage
points. When all visible bins have the same rounded disagreement, the domain
expands by one 10-point step so the graph remains readable.
The y-axis similarly covers only the currently visible FSRS and RWKV prediction
errors, rounded outward to 10-percentage-point boundaries. Zero always remains
inside the plot as the perfect-prediction reference. Both axes use tick
increments of 10 percentage points.

For every populated disagreement bin, the graph plots each model's mean
prediction error (`predicted p(recall) - actual recall`). A curve closer to zero
is better for that class of disagreement. Both model curves show a point for each
populated bucket. Their point areas use the same paired-review count and are
proportional to that bucket's share of all paired reviews. A neutral background
bar also shows each bucket's paired-review count against the graph's right axis.
The displayed UM+ value is the paired-review-count-weighted RMSE of the populated
bins' mean prediction errors.

The legend also shows a linear-regression slope for each model. It is fitted to
the currently visible bucket means using paired-review counts as weights. A
slope closer to zero means the model's prediction error changes less as FSRS and
RWKV disagree, while a slope near `+1` or `-1` indicates that the model tends to
absorb the disagreement as prediction error. The slope is shown as `n/a` when
the visible buckets do not contain enough disagreement variation for a fit.

Because both models use the same reviews in every bin, their plotted errors obey
`FSRS error - RWKV error = disagreement`, apart from floating-point rounding.

## FSRS vs RWKV ROC and AUC

The **FSRS vs RWKV ROC** graph follows UM+ and uses the same paired, eligible
review-time predictions. A review is positive when its answer was Hard, Good,
or Easy and negative when its answer was Again. Reviews missing either model's
valid probability are excluded, which keeps the comparison on an identical
sample for FSRS and RWKV.

For each model, reviews are sorted from highest to lowest predicted recall.
Each distinct prediction becomes a threshold point whose x-coordinate is the
false positive rate and y-coordinate is the true positive rate. Equal
predictions are processed together, so ties contribute half credit to AUC. The
curve begins at `(0, 0)` and ends at `(1, 1)` when both outcome classes are
present. The graph is unavailable when the paired sample has no remembered or
no forgotten review.

AUC is calculated with trapezoidal integration over the complete threshold
curve. `1.0` means every remembered review is ranked above every forgotten
review; `0.5` matches chance ranking. The orange dashed diagonal shows this
chance baseline. FSRS uses the same steel-blue color and RWKV the same sea-green
color as the Calibration and UM+ comparisons. Hover targets are sampled only
for responsiveness on large histories; the visible curves and AUC still use all
distinct thresholds.

## Calibration Confidence Intervals

Each populated calibration bucket includes a 95% card-level bootstrap confidence
interval for observed retention. Reviews are first aggregated by card and bucket,
then cards are sampled with replacement for 500 deterministic bootstrap iterations.
This preserves the dependence between repeated reviews of the same card while
keeping the graph stable across redraws.

## Legacy RWKV Cache Fallback

For legacy collections without role-aware RWKV cache columns, the endpoint
checks for these `revlog` columns, in order:

1. `rwkv_r`
2. `rwkv_review_r`
3. `rwkv_review_retrievability`
4. `rwkv_r_at_review`
5. `rwkv_retrievability`
6. `rwkv_retrievability_at_review`
7. `rwkvReviewRetrievability`
8. `rwkvRetrievability`
9. `rwkvR`

In legacy mode, if the RWKV cache table and legacy columns do not contain all
requested eligible sample values, RWKV mode shows a no-data message. Non-answer
sample rows are skipped before the completeness check and shown as warnings
instead. In role-aware mode, missing requested ids are expected when they belong
to the train split or rows RWKV does not score, so they are ignored silently.
On adapted Anki builds, the add-on asks Anki to generate missing role-aware RWKV
calibration data once, then retries the requested sample IDs. On older builds
without the ensure API, FSRS mode remains available and missing RWKV data still
produces the no-data result. If an older client omits explicit sample IDs, the
endpoint falls back to the previous current search/date-range targeting
behavior.

## FSRS7 Support

- `ts-fsrs` is pinned to upstream `6.0.0-beta.13`. The shared model selection in `src/ts/fsrsModel.ts` uses upstream `FSRS7Model` for 34-weight presets.
- FSRS-7 replay preserves internal slow stability, fast stability, and difficulty after every review. Review predictions and state transitions use actual elapsed milliseconds converted to fractional days, including same-day reviews.
- Manual memory resets clear both traces before the next rated review. Replay remains a local graph calculation; it does not rewrite review history, current card data, or due dates. Existing cached Anki predictions retain priority over replayed calibration values.
- FSRS-4/5/6 presets keep the existing 17/19-to-21 parameter migration and collection-rollover day policy through upstream `FSRS6Model`. Original 17/19-weight layouts are clipped before migration; the zero short-term weights inserted by migration are preserved.
- The separately named `ts-fsrs-legacy-preview` dependency retains the checked-in vendored implementation solely for existing 35-weight preview presets. Those weights describe a different model and are never truncated or interpreted as final FSRS-7.
- All models are bundled into both browser and worker JavaScript. Anki needs no separately installed JavaScript dependencies.
