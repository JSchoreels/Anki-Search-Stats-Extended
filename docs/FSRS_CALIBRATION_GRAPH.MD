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
    - The endpoint is called only after the user selects RWKV as the calibration
      source.
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
    - In legacy mode, if persisted values are unavailable or incomplete for the
      requested eligible calibration samples, it returns no data. The add-on
      does not recompute RWKV review retrievability by replaying scheduler
      history.
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
- RWKV state-cache build/update writes
  `search_stats_rwkv_review_retrievability` with source
  `rwkv_state_cache_build` and role `final_fit`.
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

Deck-config fallback selection order:

1. `fsrsParams7`
2. `fsrsParams6`
3. `fsrsParams5`
4. `fsrsParams4`
5. `fsrsWeights`
6. `ts-fsrs` default parameters

Accepted parameter lengths are `17`, `19`, `21`, and `34`.

Dynamic Desired Retention fields are carried with resolved presets so the graph
data path stays aligned with Anki's current preset shape. Calibration and
Memorised retrievability predictions use FSRS params and memory state; desired
retention does not directly enter `forgetting_curve()`.

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
are intentionally excluded. Selecting RWKV does not rerun the RWKV scheduler
replay and does not affect the other FSRS graphs.

Both mode overlays the FSRS and RWKV calibration lines on the same graph. The
FSRS line is blue, the RWKV line is green, and the perfect-calibration reference
line remains orange. Review-count volume bars use the same source colors and
overlap in combined mode.

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
The add-on deliberately avoids recomputing missing RWKV values, so state-cache
bugs or missing persisted state remain visible instead of being hidden by a slow
replay fallback. FSRS mode remains available and unchanged. If an older client
omits explicit sample IDs, the endpoint falls back to the previous current
search/date-range targeting behavior, but still only reads persisted values.

## FSRS7 Support

- This addon is wired to a local `ts-fsrs` fork that includes FSRS7 (34-parameter) support.
- FSRS7 parameter arrays from Anki (`fsrsParams7` length `34`) are now consumed directly by graph calculations.
