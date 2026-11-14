# Model Calibration Graph Data Path

This document describes how calibration graph data is read for graph computations,
including Anki's add-on preset overlay data and the optional RWKV calibration
source. Calculate on calibration/comparison panels does not request the separate
Memorised history when automatic Memorised loading is disabled. An empty validated
FSRS cache still requests that replay for the calibration fallback.

## History ownership

The page loads a `StatsHistory` handle containing the review count and last-forget metadata. Its worker fetches paginated history and keeps eight mixed-width numeric columns, following native Anki types: Float64 IDs, signed Int32 intervals, Uint32 time/factor and Uint8 grade/type. All eight buffers transfer together between owners. Legacy Float64 rows remain supported for local calculation callers. Calibration selection, review aggregation and Memorised use that same history through the global task queue. Each history task transfers ownership to a fresh worker after returning, releasing its temporary heap. Cancelling an active graph discards its result immediately and holds the queue until history returns; changing the search or history range terminates the owner immediately. Prediction parsing and comparison remain separate queued workers, with transferred result buffers. This changes no review selection, model formulas, cache schema or endpoint contract.

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
    - The endpoint is called automatically for the default FSRS and current-RWKV UM+ comparison.
      The calibration model selectors control the calibration graph's
      display and does not gate UM+ data loading.
    - The frontend sends the exact `revlog.id` values used by the calibration
      samples, so RWKV persisted-value checks are limited to reviews that can
      affect the graph.
    - It first reads the add-on-owned
      `search_stats_rwkv_review_retrievability` cache table for those reviews.
      On adapted Anki builds, this table lives in the attached
      `retrievability_cache` sidecar database, so it is not included in
      collection sync/full upload.
      In role-aware tables, it ordinarily returns `test_fold` and
      `post_optimization` rows; calibration `final_fit` rows suppress older
      held-out rows for reviews that have since moved into the training split.
      For the active FSRS `post_optimization` cohort, SSE also handles core builds
      that incorrectly label later RWKV replay rows as `final_fit`. A valid
      captured `rwkv_review` prediction keeps priority over that recompute row.
      Without a captured answer, a `rwkv_calibration_recompute` prediction is
      exposed as `post_optimization_replay` in the response only. Genuine
      `rwkv_calibration_train` markers remain suppressors and prevent this replay
      fallback. FSRS historical training rows and stale post-optimization markers
      remain excluded. This selection changes no stored rows or cache schema.
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
      API exists. SSE checks `rwkv_calibration_data_available()` when available
      and retries the cache read only when generation may have changed rows.
      The API is a no-op when current
      data is already complete and otherwise runs Anki's calibration-only
      historical replay while preserving active reviewer state.
    - The endpoint reads FSRS rows once and shares them with each RWKV cache
      read, including the read after lazy generation. The `ensure_fsrs_alignment`
      flag controls alignment checks; it does not control whether the active
      FSRS post-optimization cohort can use recovered RWKV replay predictions.
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
      worker replay used by `getMemorisedDays()`.

## Frontend Worker Inputs and Results

`getMemorisedDays()` returns calibration samples as three index-aligned typed
columns: `revlogIds` and `cardIds` (`Float64Array`) and `actual` (`Uint8Array`).
Selection and Memorised replay construct those columns from bounded numeric chunks, avoiding growing JavaScript sample arrays beside their final typed copies.
Its `fsrs_calibration_replay_predictions` is a `Float64Array` aligned to those
samples. Statistics requests FSRS and RWKV prediction streams independently.
The `calibrationPredictions` worker consumes bounded pages, validates metadata,
aligns predictions by review ID, and computes calibration bins. A separate
`calibrationBands` task adds confidence intervals after the bins appear. Ordered
response rows merge directly, including duplicates crossing page boundaries.
Shuffled sample IDs retain the sorted-index merge. Legacy full JSON responses
still support shuffled rows. Workers transfer result buffers instead of cloning
them; missing predictions remain `NaN`.

Each calibration store exposes `predictions: Float64Array`, with `NaN` for
samples absent from the response. Response prediction counts retain all unique
review IDs with finite validated values, including IDs outside the selected
samples and values outside `[0, 1]`. A non-empty FSRS response keeps priority
over replay even if none of its values can contribute to bins. Only an empty
validated response uses replay through the `calibrationReplay` task. Graph
calculations continue to accept only finite probabilities within `[0, 1]`.

Once history and both calibration stores load, the `comparison` worker task
builds UM+, ROC, and both models' daily results, with replay-only FSRS predictions
replaced by `NaN` (see the ROC section). The default UM+, ROC, and daily panels
reuse its results when available. Daily panels can also show each selected source
as soon as its predictions are ready; obsolete computations are cancelled.
Warnings remain logged on the main thread and displayed by the existing panels.
Automatic preparation, revision triggers, cohort selection, provenance counts,
warning totals, and the `refresh_after_fsrs` handshake are unchanged.

Model Calibration, UM+, ROC, Daily Recall Gap, and Daily Log Loss share one on-demand store for the explicit RWKV model
prediction arrays and their calibration bins. Selecting a model in any
graph loads its aligned predictions once for the current sample. Calibration
requests that model's bootstrap intervals when needed; the comparison graphs alone do not start
the bootstrap. When the search or date range changes, the old requests are
cancelled and their results cannot replace the new sample. The existing
profile-local model replay files remain the source for subsequent page loads.

### Streamed prediction transport

`fsrsReviewRetrievability` and `rwkvReviewRetrievability` accept optional
`stream_pages: true` alongside the existing `cids`, `day_range`, `revlog_ids`,
and RWKV `ensure_fsrs_alignment` fields. Omitting the flag retains the full JSON
response contract. The frontend also accepts full JSON from an older Python
module still running before Anki has been restarted.

The streaming response has Content-Type `application/x-ndjson`. Its first line
contains `format: "prediction-pages-v1"`, `row_count`, and the same response-wide
metadata (`column`, optional `warnings`, `roles`, `role_counts`, and
`refresh_after_fsrs`). Following lines contain `data: [[revlogId, prediction],
...]`, with at most 25,000 rows each, ordered by review ID. A final
`{"done": true}` line completes the response. The worker checks ordering, row
count and completion before returning predictions; truncated or malformed
responses cannot publish a partial cohort. UTF-8 and lines may cross network
chunk boundaries. Last-valid duplicate semantics and response-wide finite-value
counts apply across pages.

One HTTP request still selects and prepares one complete cohort. Paging does not
repeat native generation, change legacy completeness checks, or request separate
subsets. Python retains its selected rows while yielding bounded serialized
pages; it avoids creating one full serialized response. The page transfers the
unread body stream to the queued prediction worker, keeping JSON text and parsed
rows bounded rather than retaining a full response alongside aligned values.
Changing the search aborts the fetch and terminates obsolete workers. FSRS and
RWKV responses remain independent; parsing and all other heavy tasks keep the
shared worker queue.

## Persistent Prediction Cache

Calibration caches store raw review-time predictions keyed by `revlog.id`, not
pre-binned graph data. This keeps the persisted data reusable across search
queries, date ranges, and future graph variants.

The add-on can create these tables lazily when running without a core
producer, but the Anki fork may also create and populate them through explicit FSRS
calibration generation and RWKV calibration replay. On adapted Anki builds, Anki attaches
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

- Current adapted Anki exposes `ComputeFsrsReviewRetrievabilityCalibration`
  for explicit historical calibration generation, writing
  `search_stats_fsrs_review_retrievability` with source
  `fsrs_calibration_recompute`. Ordinary optimization does not populate this
  cache. Older builds wrote `fsrs_optimization` rows during optimization.
  SSE prepares this data automatically when eligible FSRS statistics load.
  Existing cache predictions remain available during preparation.
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

Accepted parameter lengths are `17`, `19`, `21`, and `34`. The older 35-weight FSRS-7 preview layout is not supported.

Dynamic Desired Retention fields are carried with resolved presets so the graph
data path stays aligned with Anki's current preset shape. Calibration and
Memorised retrievability predictions use FSRS params and memory state; desired
retention does not directly enter the model's retrievability calculation.

## Automatic Historical FSRS Calibration

When SSE has loaded eligible FSRS history for the current Statistics search, it
calls `/_anki/startFsrsCalibration` and polls `/_anki/fsrsCalibrationProgress`
automatically. Each selected card population is prepared once per stats page;
date changes and repeated calculations for already prepared cards do not repeat
the job. A new selection arriving during preparation waits for that job and is
then checked. Reopening Statistics starts a fresh settings/history check.
The check runs in a non-modal background `QueryOp`; existing graphs remain
displayed. A successful unchanged check (`generated: false`) neither reloads the
FSRS cache nor recalculates calibration bins, UM+ or ROC. Native training progress
opens only when the check finds missing/stale validation data requiring generation.
The generation operation rechecks the current collection before invoking the API.
The worker computes the completion fingerprint before returning to Qt. The Qt
success callback only publishes that result. Media-server cache-reuse queries run
outside the service state lock so native progress can read the state while SQL waits.

Existing FSRS and RWKV caches load independently and remain usable during
preparation. Empty RWKV caches wait for a pending FSRS job before starting
RWKV generation; the completion refresh then reads/generates aligned predictions.
A serialized Anki `QueryOp` provides native progress and Cancel during generation;
concurrent stats windows share the pending operation. Generation or failure refreshes
available graph caches (a failed job may have written some completed presets).
RWKV requests check alignment against existing FSRS rows as they load. If missing
RWKV data was deferred behind an FSRS check, its response marks `refresh_after_fsrs`;
the frontend refreshes only RWKV after an unchanged check, regardless of response
order. Complete caches require no second read. Cancellation or failure stops automatic retries for the
current stats page; close and reopen Statistics to retry. There is no Generate
button or diagnostic replay override. Progress and warnings remain visible in
the calibration panel, while a completed successful job adds no status panel.

On adapted Anki builds, `fsrs_calibration.py` calls the supported backend
`compute_fsrs_review_retrievability_calibration` API with validation folds
enabled. Generation covers the complete collection population sharing each
selected card's resolved preset settings, independently of graph search and date
range. Without overlay rules, SSE resolves settings once per home deck and uses
Anki's short `preset:"<name>"` optimizer search. With overlay rules, the native
batch preset-ID response routes cards and settings resolve once per distinct
(preset ID, home deck). Exact card-ID searches preserve split group membership.
Distinct overrides remain separate even when preset IDs match.

The API receives current parameters, FSRS version, optimizer search (default
`-is:suspended`), ignore-before date, within-day relearning-step count, and FSRS-7
same-day/scheduling-penalty options. Filtered cards use their original deck options.
Unsupported FSRS-7 presets are reported and not passed to the final FSRS-7
backend. Anki owns cache writes through supported APIs; SSE does not reschedule
cards, change parameters, or rewrite reviews.

Version-2 add-on records in `user_files/fsrs-calibration-<collection-path-hash>.json`
track resolved settings, the completed historical boundary, an aggregate history
fingerprint, and cache coverage. Fingerprints use SQL count, latest ID and a
checksum over review IDs, card IDs, ratings, types, intervals and factors. Exactly
offsetting edits can collide. Matching records reuse generation; new answers
alone do not require retraining. Changed settings, edited/removed historical
reviews or lost cache coverage trigger regeneration. Existing validation caches
are adopted initially; their original parameter freshness cannot be established
retrospectively. Before generation, the group record is persisted with `pending:
true`; successful completion replaces it with a completed record. Pending groups
always regenerate, including on first-run retries with partially saved validation
rows. This supports Anki's cancellable batched cache writes and survives cancellation
or process exit. Metadata remains local and is preserved by runtime sync.

RWKV requests with `ensure_fsrs_alignment` check FSRS validation IDs against valid
RWKV test-fold predictions and check active FSRS post-optimization coverage.
Reviews recorded as `final_fit` from `rwkv_calibration_train` are excluded from
forced repair: a replay cannot turn training reviews into held-out predictions.
Their unpaired count is reported separately. Fixable missing coverage calls the
supported `recompute_rwkv_calibration_data` API; otherwise the native availability
check/ensure API verifies current data and fold alignment. Complete data does not
cause another full cache read. Remaining eligible gaps produce count-only warnings.
Comparisons use available paired reviews.

Completed forced replays are remembered for missing review IDs only while their
collection and relevant cache state match. SSE reads exact FSRS/RWKV cache rows
and column sets for just those missing review IDs; it does not scan unrelated
cache rows or use a collection-wide write counter. Capture occurs after completed
generation, so its own writes do not immediately trigger another attempt. Later
changes or clears of those rows, external commits affecting them, changed cache
columns or a profile change permit repair again for the same review IDs.
Temporary search-table writes and unrelated cache updates do not invalidate it.
Failures are not recorded as completed, and unchanged unfillable gaps do not
force replay on every search change. This state is session-only; it changes no
cache schema, collection data or add-on configuration.
Builds without the historical FSRS API retain existing cache/replay behavior and
report that automatic generation is unavailable.

## Export Troubleshooting Info

The `stats_dialog_will_show` hook adds **Export troubleshooting info** to Anki's
native Statistics button box beside Save PDF. If the hook/button box is absent,
the same action appears in SSE's Support area. Both use the current graph inputs
and Anki's native save dialog to write a UTF-8 `.txt` file. Export adds no history
replay, training, database query or network request. Cancelling the save dialog
writes nothing. Export before data is ready explicitly identifies unloaded inputs.

The report includes SSE build, Anki version/build, operating system and historical
calibration API availability; automatic-generation state, result and warnings;
eligible and replay counts; selected FSRS/RWKV sources, roles, counts and UTC review-date
ranges; paired count; and UM+ populated/visible bucket counts. Saved RWKV
post-optimization predictions and recovered replay values have separate counts.
The calibration summary omits card content, individual review IDs and search text.

Graphs prefer available validation/post-optimization cache predictions. Browser
replay remains the fallback when no eligible FSRS cache exists. It uses current
parameters and a different eligible review sample, so it does not reproduce
fold-trained validation predictions. There is no user-facing source override.


## Model Calibration Selectors

Model Calibration has independent first and second model selectors. The first
defaults to FSRS, and the second defaults to None so one model is shown. Either
selector can choose FSRS, FSRS-6, RWKV (current), RWKV Big, RWKV Small Curve, RWKV Small
Instant, or RWKV Tiny Instant; selecting a second model overlays its curve.
The first series is blue, the second green, and the perfect-calibration reference
line is orange. Review-count volume bars use the series colors and overlap.
Each model uses its own eligible reviews rather than a paired intersection, so
counts can differ between series. This preserves the original calibration
behavior; UM+ instead compares only reviews with predictions from both models.

The explicit FSRS-6 source uses chronological validation folds: each fold is
scored with FSRS-6 parameters trained only on earlier reviews. Historical
comparisons therefore do not replay the saved parameters on their training
reviews. A deck must have saved FSRS-6 parameters to enable this source; decks
without them are reported as unavailable. Preparation runs on demand and keeps
its predictions in an add-on-owned cache, separate from Anki's active FSRS
prediction cache. Current-card comparisons use the saved parameters instead.

FSRS first uses role-aware cached
FSRS retrievability for each eligible review, preferring historical validation
and post-optimization samples over replayed in-sample values. If no cached FSRS
calibration rows exist yet, it falls back to the existing replayed FSRS
retrievability value for each eligible review.

RWKV (current) reuses the same eligible review samples identified by
[`getMemorisedDays()`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/MemorisedBar.ts),
then requests RWKV probabilities for those sample `revlog.id` values from
`/_anki/rwkvReviewRetrievability`. With a role-aware RWKV cache table, the graph
uses the sparse held-out rows returned by that endpoint; train/final-fit rows
are intentionally excluded. On the first cache miss, adapted Anki builds may
run one calibration-only RWKV replay through the public ensure API. Later graph
loads reuse the persisted result, and active reviewer state is restored after
generation. The four explicit RWKV models use the same isolated, model-specific
history replays and persistent add-on caches as UM+, described below. Their
bins and confidence intervals use the existing calibration computations.

## Model Current Disagreement

The **Model Current Disagreement** histogram compares current card
retrievability rather than review-time predictions. Its independent selectors
offer FSRS, FSRS-6, RWKV (current), RWKV Big, RWKV Small Curve, RWKV Small Instant and
RWKV Tiny Instant, initially FSRS and RWKV (current). It uses the cards in
the current statistics search, independently of the review date range and
historical Memorised calculation. Each card with both valid current probabilities
belongs to one bucket, rounded to the nearest 5 percentage points of
`first model R - second model R` (41 possible centers from -100% to +100%). As in UM+, exact
halfway values round toward the higher center. All populated buckets are shown;
there is no minimum card count. Bars show card counts, with bounds in their
tooltips. Lower bounds are inclusive and upper bounds exclusive, except +100%.

Clicking a bucket opens the browser in Cards mode, searches its exact card IDs,
and selects all results after saving any pending browser edit. Keyboard users
can focus a bar and press Enter or Space. Missing scores are excluded, and the
chart reports paired cards out of all cards in the search.

The default pair reuses the paired snapshot for **FSRS vs RWKV Card
Retrievability**. Other pairs join the two selected models by card ID, so an
RWKV-only pair does not require an FSRS prediction, and FSRS-only comparisons do
not require a current-RWKV prediction. The add-on obtains independent FSRS values
through `currentFsrsModelPredictions`; `currentCardDisagreement` also returns
the configured RWKV model's independently eligible scores and status.

The explicit FSRS-6 source reconstructs a separate memory state from review
history using the saved FSRS-6 parameters of each card's home-deck preset.
Cards whose home-deck preset has no valid saved 21-parameter FSRS-6 model are
excluded with an availability message; the implementation never substitutes
default weights. It uses the native current-statistics elapsed-time convention
and leaves cards and scheduler state unchanged. Its scores are transient and are
recomputed when the comparison or search is reopened.

The four explicit RWKV models use the same model weights and output heads as
UM+, but their review-time prediction cache cannot supply current card state.
When selected, each model replays complete collection history in an isolated
native runtime, then scores the searched cards using their current scheduling
inputs, including cards in decks where RWKV scheduling is disabled. The configured
RWKV source retains its scheduler's usual eligibility rules. The replay runs in a
background job, is serialized with other explicit model replays, reports review
and card progress, and can be cancelled when the selection, search or visibility
changes. Completed scores are reused while the graph remains visible and the
search is unchanged. They are transient and do not create another persisted cache.
Large histories can take time to prepare; model scores represent the time
each model was prepared, so two models may have been scored at different times.
Reopen Statistics to refresh the snapshots. Changed history, replay settings,
profile or model weights prevent a partial or obsolete result from being used.

`/_anki/currentCardDisagreement` returns the configured-model snapshot. The add-on's
`current_disagreement.py` adapter uses the adapted Anki scheduler's guarded,
batched current RWKV statistics scoring path and the Collection API
`card_memory_metrics(..., include_retrievability=True)`. The backend computes R
from the complete stored memory state, resolved preset and fractional elapsed
days, using the same curve as Anki's native Card Retrievability chart. For FSRS-7,
this includes slow and fast stability and the card's difficulty. The scalar
`fsrs_current_retrievability()` compatibility helper assumes equal stability
traces and difficulty 5, so it must not be used for these current-card charts.
Cards without both selected models' valid probabilities are excluded; the backend resolves
missing last-review timestamps from review history without updating cards.
Builds without the full-state metrics API show an unavailable message.
It adds no persisted cache or direct database operations. The RWKV
adapter requires the scheduler's state-token and search-score helpers; builds
without those capabilities show an unavailable message. Pending warm-up is
polled, errors offer Retry, and results from an obsolete search are discarded.
During these add-on requests, scheduler logs abbreviate generated card-ID
searches longer than 256 characters to their card count and omit repetitive
per-batch success messages at DEBUG level. Summary timings, warnings and errors
remain available. The filter is scoped to the requesting context; scheduler
logs from other operations or threads are not suppressed.

Package with `npm run build` followed by `./package.sh`; `./copy_to_anki.sh`
installs that archive into `addons21/1339555413`, preserving Anki-owned metadata,
configuration and user files. Fully quit and reopen Anki after Python changes.

## FSRS vs RWKV Card Retrievability

The **FSRS vs RWKV Card Retrievability** histogram immediately follows current
Disagreement and uses the default FSRS/current-RWKV transient prediction snapshot,
loading state, retry, search scope, and paired-card eligibility. Its models do not
change with the Disagreement selectors. It makes no additional prediction requests
and introduces no persisted data or database operations.

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
The compact legend uses three rows: **Steps lower: 5+ 4 3 2 1**, **Same range**,
and **Steps higher: 1 2 3 4 5+**, with a color swatch beside each value. Direction
is written once per row, and the order runs from the largest downward move to
the largest upward move. Hovering a legend value shows its full description,
such as **2 steps lower**. A bulleted guide explains the selected grouping
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

The Card Retrievability comparison is followed by **Daily Recall Gap** and
**Daily Log Loss**, each with editable moving averages and date zoom. Daily
Recall Gap compares any one or two models' eligible predictions with the actual
recall rate across all graded reviews that day. Daily Log Loss also compares any
one or two models and uses each model's eligible predictions and matching
outcomes. Both default to FSRS and current RWKV. FSRS uses held-out cached predictions, without the calibration replay
fallback. Their calculations and grouping are documented in
[Daily recall gap and log loss](RWKV_DAILY_SURPRISE.MD).

## Model UM+ Comparison

The UM+ graph follows the calibration graph. Its two independent model
selectors default to FSRS and RWKV (current), and also offer FSRS-6, RWKV Big, RWKV
Small Curve, RWKV Small Instant and RWKV Tiny Instant in either order. The
current choice uses the existing RWKV calibration stream, which represents the
configured runtime and may coincide with one of the explicit models. The selector
is independent of the Model Calibration selectors.
The default comparison can trigger the existing current-RWKV calibration-data
generation path described above.

The explicit model choices replay the complete collection's historical RWKV
inputs in a separate native runtime, without replacing the live reviewer's
state. Big uses the `legacy` model's Instant prediction; Small Curve uses the
`sm72e25` model's Curve probability; Small Instant uses `sm98`; and Tiny Instant
uses `sm101`. They are generated only when selected. The graph shows progress;
the initial Curve replay makes a native pre-answer query per review and can take
longer than the bulk Instant replays. The independently replayed models score
all eligible calibration review samples, while current RWKV retains its
role-aware cache selection. A pair involving FSRS also requires a held-out FSRS
prediction, so its sample can differ from an RWKV-only pair. These pretrained
RWKV predictions are not a claim that every review was held out from the
models' original training data.

The add-on saves each completed model replay as
`user_files/um-plus-<collection-path-hash>-<model>.json`. These private files
contain review IDs and predictions plus the model/head, weights and native
runtime hashes, Anki build, state precision, replay settings and complete-history
fingerprint. A validated unchanged history reuses its file; if the old history
is still a valid prefix, its predictions are retained and only new reviews are
scored after reconstructing the recurrent state. Edited history, changed
settings, model weights, native runtime or build cause a full replay. Writes use
an atomic file replacement; failed or obsolete replays do not publish a partial
result. The data is add-on-owned, not stored in the collection database.
The `startRwkvUmPlusModel` and `rwkvUmPlusModelProgress` endpoints start and
track a serialized model job; `rwkvUmPlusModelPredictions` returns the requested
review IDs through the existing prediction-page transport. Missing bundled
models and replay failures are displayed with a retry action.

Only review ids with eligible predictions from both models are included. Reviews
are grouped into 41 fixed bins by signed prediction disagreement:

`first model p(recall) - second model p(recall)`

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
The y-axis similarly covers only the currently visible selected-model prediction
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
slope closer to zero means the model's prediction error changes less as the two
models disagree, while a slope near `+1` or `-1` indicates that the model tends to
absorb the disagreement as prediction error. The slope is shown as `n/a` when
the visible buckets do not contain enough disagreement variation for a fit.

Below the plot, the absolute-disagreement summary shows P68, P95 and P99.7 of
`abs(first model p(recall) - second model p(recall))`. These are nearest-rank empirical
percentiles of the individual eligible paired reviews, before binning. A P95
threshold means at least 95% of paired reviews have an absolute prediction gap
at or below that value. Thresholds are rounded upward to 0.1 percentage points
for display (`pp`); they include small hidden buckets and do not change with
the visibility toggle. The population counts reviews, not unique cards, so a
card reviewed repeatedly contributes repeatedly. The percentages are measured
coverage levels and do not assume a normal distribution or represent standard
deviations. Empty paired populations have no percentile summary.

Because both models use the same reviews in every bin, their plotted errors obey
`first model error - second model error = disagreement`, apart from floating-point rounding.

## Model ROC Comparison and AUC

The **Model ROC Comparison** graph follows UM+. Its independent selectors default
to FSRS and RWKV (current) and offer the same individual RWKV models as UM+.
It reuses their model-specific predictions and computes ROC for the selected
pair in a statistics worker. A review is positive when its answer was Hard,
Good, or Easy and negative when its answer was Again. Reviews missing either
model's valid probability are excluded, so both curves use an identical sample.

For each model, reviews are sorted from highest to lowest predicted recall.
Each distinct prediction defines a threshold whose x-coordinate is the false
positive rate and y-coordinate is the true positive rate. Equal
predictions are processed together, so ties contribute half credit to AUC. The
curve begins at `(0, 0)` and ends at `(1, 1)` when both outcome classes are
present. The graph is unavailable when the paired sample has no remembered or
no forgotten review.

AUC is calculated with trapezoidal integration over the complete threshold
curve as thresholds are processed; the complete point list is not retained. `1.0` means every remembered review is ranked above every forgotten
review; `0.5` matches chance ranking. The orange dashed diagonal shows this
chance baseline. The first selected model uses steel blue and the second uses
sea green, as in UM+. Hover targets are sampled only
for responsiveness on large histories. The plotted curve retains the existing
points whenever either axis advances by at least 0.001 and always retains the
final endpoint. AUC and confidence placements still use all distinct thresholds,
so display sampling does not change the metrics.

Each model's AUC and the paired AUC difference (`first model − second model`) include 95%
card-clustered DeLong confidence intervals (Obuchowski 1997). Clustering by card
accounts for correlated reviews of the same card, matching the card-level
bootstrap used for calibration bands. When the difference interval includes
zero, the two models are not distinguishable on this sample. Intervals and the
paired difference are unavailable with fewer than two card clusters containing
remembered reviews or fewer than two containing forgotten reviews; AUC remains
available when both outcome classes are present. The six confidence-interval
accumulators are sized to eligible card clusters, rather than the number of
paired reviews; their accumulation order and covariance calculation are unchanged.

When FSRS is selected, UM+ and ROC use only held-out FSRS predictions from
Anki's calibration cache. If that cache returns nothing, browser replay still
feeds Model Calibration, but the comparison does not use those replay predictions:
current parameters were usually optimised on the same reviews. A comparison
involving FSRS shows loading while calibration generation is queued or running,
then a held-out-unavailable message if the cache stays empty. RWKV-only UM+ and
ROC pairs do not wait for FSRS predictions. Daily RWKV scores remain available
independently; daily FSRS scores use the same held-out cache boundary.

## Calibration Confidence Intervals

Each populated calibration bucket includes a 95% card-level bootstrap confidence
interval for observed retention. Reviews are first aggregated by card and bucket,
then cards are sampled with replacement for 500 deterministic bootstrap iterations.
This preserves the dependence between repeated reviews of the same card while
keeping the graph stable across redraws. Aggregation consumes the numeric sample
columns directly through a reusable observation; it does not build a retained
per-review object array. Card/bin contributions use dense numeric chunks and compact per-card ranges. The collection frame releases its map/counters before resampling. First-seen card order, random draws, seed and per-bin floating-point summation order are unchanged.

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
- The earlier 35-weight FSRS-7 preview is not supported. Those weights describe a different model and are never truncated or interpreted as final FSRS-7.
- All models are bundled into both browser and worker JavaScript. Anki needs no separately installed JavaScript dependencies.
