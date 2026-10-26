# Changelog

## Unreleased

### User facing changes

- Add a separate Net Memorised per 100 Reviews graph with independent FSRS / RWKV / Both selection. Count every answer or repetition once, show negative days when collection-wide forgetting exceeds gains, and use a configurable 7-day rolling ratio by default while retaining the raw daily line. Fit the averaged view to its colored lines so extreme low-review days no longer flatten the graph; disable averaging to inspect raw values at full scale.

- Smooth every Memorised view with a configurable 7-day moving average by default. Colored FSRS/RWKV averages remain comparable while faint grey lines retain the daily estimates; disable smoothing to restore the original daily lines.

- Hide individual add-on graph cards, including favorites, and reveal them with Show hidden graphs at the top of Statistics. Unhide restores a card to its category or saved Favorite position. Hidden choices are remembered between visits.

- Drag the new horizontal scrollbar below a bar chart's x-axis to move through its range. It stays synchronized with the numeric Scroll field, follows the axis direction, and supports arrow keys and Home/End.

- Star favorite add-on graphs to keep them above Anki's built-in charts, below the search controls. Favorites remember their order, retain their current controls when moved, and remain accessible when their original category is collapsed or hidden.

- Add FSRS to Daily Recall Gap and Daily Surprise, with independent FSRS / RWKV / Both controls. Show a configurable 7-day moving average by default and fade the daily lines and dots to grey; disable smoothing to restore the colored daily values.

- Restore FSRS preset loading and the stability/retrievability heatmap on older fork builds, including portable build 88, without the missing `card_memory_metrics` error. Newer builds retain batch loading; older builds use slower native Card Info reads.

- Show UM+ absolute-disagreement thresholds for 68%, 95% and 99.7% of paired reviews, with a legend explaining percentage points, repeated card reviews and hidden-bucket coverage.

- Give maturation counts and milestone/new ratios separate full-height graph cards. Default each vertical axis to P90, with an editable percentile and P100 full-range option. Add individual curve visibility controls and optional moving averages that replace the daily lines, with a shared day window and rolling totals for the ratios.

- Add a compact Exposure × Stability matrix in the Lapse section with four saved, editable rep/S90 thresholds. Show active studied card counts and FSRS curve workload in all nine cells, row and column totals, and a main-diagonal total, with explicit population and unavailable-workload coverage.
- Compare daily introductions with cards first becoming Maturing or Matured at the matrix's two S90 cutoffs. Show both milestone/new ratios, leaving gaps on days without introductions, in a new Daily maturation panel in the Introduced section.

- Further reduce Statistics memory during UM+/calibration refreshes and full Memorised replay: peak renderer RSS fell from 2.38 GiB to 2.21 GiB (7.3%, about 178 MiB), and the preserved 3.8-million-review workload completed in 116.1 seconds instead of 125.9 seconds in a fresh before/after pair.
- Store the same review history in 47% smaller buffers (231 MiB to 123 MiB for this snapshot), collect calibration samples in numeric chunks, compact replay grouping and release bootstrap counters before resampling. Preserve the checked graph results and controls.

- Further reduce memory for large Statistics workloads: peak renderer RSS fell from 3.44 GiB to 2.38 GiB (31%, about 1.06 GiB) and total time from 128.2 to 120.9 seconds in a new before/after run of the preserved 3.8-million-review Qt workload.
- Keep one copy of review history across calibration selection, aggregation and Memorised. Store daily transitions and remaining private time samples compactly while preserving exact graph results. Build the same ROC curve and metrics without retaining every threshold point; a separate 1.5-million-distinct-probability test used 42% less peak renderer memory.

- Further reduce Statistics memory when UM+/calibration refreshes while full Memorised history is retained: peak renderer RSS fell from 3.70 GiB to 3.26 GiB (12%, about 450 MiB) in the same preserved 3.8-million-review Qt workload. Total time fell from 140.3 to 129.0 seconds in this additional before/after run.
- Keep exact Time graph means, medians, success/same-day filters, bar widths and scrolling while storing shared durations compactly. Stream both models' predictions in bounded pages and transfer worker result buffers to reduce overlapping allocations.

- Reduce memory use for large review histories throughout Statistics loading and graph replay, including UM+, calibration and Memorised. In one preserved 3.8-million-review Qt regression run, peak renderer memory fell from 5.1 GiB to 3.7 GiB (27%), and total time fell from 170.5 to 158.1 seconds.
- Load calibration, UM+, ROC and RWKV daily graphs without starting the separate Memorised history when automatic Memorised loading is disabled. Memorised retains its Calculate action; automatic loading and the empty FSRS-cache replay fallback remain available.
- Avoid unnecessary sorting when cached predictions already arrive in review order, and calculate the same confidence bands without a retained object for every review.

- Preserve recent RWKV replay predictions after lazy cache generation, including requests without the alignment flag.
- Reuse completed RWKV repair attempts only while the cache is unchanged. Cache updates, clears, table replacement and profile changes allow another repair; failed attempts remain retryable.
- Avoid repeated RWKV replay for training reviews and unchanged unfillable gaps. Report training reviews separately from missing held-out predictions.
- Share FSRS rows across RWKV cache reads and skip the second full cache read when Anki reports complete data.
- Keep calibration graphs displayed after an unchanged validation check, avoiding a second cache load and graph calculation each time Statistics opens.
- Check existing FSRS validation data in the background; open native training progress only when generation is needed.
- Prepare historical FSRS calibration automatically when eligible FSRS statistics load. Reuse completed history and refresh model caches when generation changes them.
- Keep cached graphs available during generation. Preserve native progress and Cancel; a cancelled or failed job retries when Statistics is reopened.
- Remove the test-build diagnostic panel, full-history replay override and Generate button.
- Add Export troubleshooting info beside Save PDF, with a Support-area fallback when the native button cannot be installed. Save aggregate calibration counts, date ranges, model sources, generation status and Anki environment details as a text file.
- Identify unloaded data in troubleshooting exports instead of reporting misleading zero counts. Cancelling export writes no file.

### Technical details

- Compute net Memorised efficiency as 100 times summed daily estimate changes divided by summed review counts, preserving no-review and unavailable-model gaps. Add signed line-chart domains with a zero reference, exclude display-only raw underlays from averaged y-axis domains while retaining their tooltip values, and keep the new graph's source choice independent while sharing the existing RWKV history job.

- Reuse the shared trailing calendar-day average before Memorised zoom cropping, retain raw-series tooltips and FSRS/RWKV line distinctions, and keep smoothing local to the current Statistics view without changing replay or cache data.

- Persist the `hiddenGraphs` ID list through the same serialized preference helper as Favorites. Centralize card visibility so hidden status overrides pinning and automatic per-graph requests until the temporary reveal mode is enabled; restore hidden cards even from collapsed or removed categories.

- Add shared bar-navigation bounds and bidirectional offset conversion without changing grouping, aggregation, trends, or browse actions. Date navigation skips leading epoch padding while retaining quiet days; scrollbar navigation reuses loaded data and adds no requests or settings.

- Store Favorites in the ordered `pinnedGraphs` add-on setting using stable graph IDs and serialized configuration writes. Relocate live graph cards instead of duplicating them, and keep automatic matrix, current-retrievability, and preset requests scoped to visible or pinned graphs.

- Reuse the comparison worker's held-out FSRS predictions for daily scores while preserving each model's independent eligible sample. Share the trailing daily-average helper with maturation graphs; preserve missing-day and undefined-gap breaks, and expose raw and averaged values through mouse and keyboard tooltips.

- Detect `Collection.card_memory_metrics` by capability and fall back to per-card `card_stats_data` only when it is absent. Preserve native retrievability, optional-field semantics, valid zero values, preset routing and the existing response format. Card Info may initialize missing card metadata through Anki's supported API.

- Calculate nearest-rank disagreement percentiles from individual valid prediction pairs before binning; round thresholds upward to 0.1 percentage points for display without assuming a normal distribution.

- Calculate axis ceilings from the selected raw or averaged daily series maxima, ignore unavailable ratio days, and clip plotted peaks without changing tooltip or trend values. Smooth counts by calendar day and ratios by rolling milestone/introduction totals; preserve partial-window coverage and zero-denominator gaps.

- Reuse shared resolved presets and the full FSRS model state for curve intervals, with a one-day workload floor. Render within the Lapse category's responsive grid and follow its show/hide controls; request current presets only while needed and avoid loading review history for this current-state panel.
- Replay full available history on demand in a separate maturation worker, preserving complete initial learning coverage, native history filters and both FSRS-7 traces. Retain compact record-high S90 transitions so cutoff changes do not replay history; dispose the history worker and reject obsolete search results. Bound maturation charts to the selected date range, preserve missing ratios and show isolated daily values.

- Use native-width review columns: Float64 IDs, signed Int32 intervals, Uint32 time/factor and Uint8 grades/types, with validation against truncation or wrapping. Transfer all eight buffers between history owners; keep legacy Float64 inputs supported through shared strided views.
- Build calibration samples in 16,384-row typed chunks. Group replay rows with Uint32 indices/offsets and learning-cycle views, releasing grouping before numerical replay. Collect card/bin bootstrap counts in numeric chunks and release the collection frame before the unchanged 500 deterministic resampling iterations.
- Verify 448 tests in 61 suites, bundle/type checks, exact equality of all 83 review/Memorised fields and calibration selection on a preserved-history subset, native-width boundaries/transfers, bootstrap/replay parity, and actual Qt history cancellation, Time controls and Calculate actions. The new benchmark compares against `089adca`, uses synthetic predictions and excludes Python memory; single-run timing and RSS vary. See `docs/STATS_PERFORMANCE.MD` for the measured workload and limits.

- Load paginated packed history directly in its owner worker; the page retains count/reset metadata. Transfer the same history buffer to a fresh worker after each history task to release temporary heaps. Active graph cancellation rejects immediately but holds the queue until history returns; obsolete search/range lifetimes terminate the owner immediately. Calculator errors return ownership; fatal/transport errors release the queue.
- Retain daily S90 card/key pairs in numeric chunks with only a current-day index map, preserving same-day order, resets and exact local/batch keys. Compact the two private replay time groups into shared durations and grouped indices. Integrate exact ROC AUC incrementally with unchanged placements, plotted thresholds and card-cluster covariance.
- Verify 436 tests in 60 suites and bundle/type checks, exact 83-field calculator parity on a preserved-history subset, frozen ROC point/AUC parity, native FSRS checks, error/cancellation/store lifetime tests, and actual Qt history/Time controls. Compare identical ROC output hashes and repeat the retained-result Primarius stress sequence; record single-run methodology and limits in `docs/STATS_PERFORMANCE.MD`. No database, Python endpoint, dependency or configuration changes.

- Store Time samples as one shared duration buffer plus grouped 32-bit indices and offsets, constructed from numeric chunks. Transfer each result-owned backing buffer once, preserving shared filter data.
- Add optional `stream_pages: true` to prediction endpoints. One NDJSON response carries complete-cohort metadata, ordered pages of at most 25,000 rows and a completion marker. Parse incrementally in the queued worker, check row counts/completion, and preserve duplicate, warning, role and refresh semantics. Existing full-JSON requests remain supported; no schema or prediction-generation change.
- Size all six ROC card-cluster confidence accumulators by eligible card count. Preserve the accumulation order and independent DeLong/Obuchowski parity.
- Verify 419 tests, bundle/type checks, unbuffered Flask serialization, shared-buffer transfers and Qt Time controls. Repeat the retained-result Primarius stress sequence with refreshes during replay; synthetic probabilities verify allocations and integration, not live model accuracy. Record the new baseline and final figures separately in `docs/STATS_PERFORMANCE.MD`.

- Keep history packed from paginated loading through worker processing. Borrow reusable review cursors, retain replay indices/byte flags and numeric stability columns, and share cycle selection between calibration and full replay.
- Preserve stable shuffled/duplicate ordering, FSRS reset/cutoff/bridge rules, sparse predictions and the deterministic card bootstrap.
- Verify 398 tests, both frontend bundles and the actual Svelte Calculate buttons in offscreen Qt WebEngine. The memory/time comparison uses the same preserved Primarius history and synthetic predictions for 1,518,677 selected reviews, retaining all graph results and refreshing predictions during full replay. It is a single before/after allocation test, not a live-cache or model-accuracy benchmark.

## 2026-10-10

### User facing changes

- Reduce memory use when loading UM+ and FSRS graphs for large collections, including when newly generated predictions refresh during Memorised replay. Full review history remains included. Graph calculations run in sequence, so refreshed graphs may appear later.
- Keep Anki responsive while calibration completion fingerprints are checked, and retry interrupted FSRS generation when only some validation batches were saved.

### Technical details

- Fetch review history in pages of 25,000 rows and transfer eight numeric columns to workers. Retain daily S90 transitions instead of every FSRS-7 request state.
- Serialize all statistics workers, including prediction parsing, bands, and comparisons. Merge prediction rows directly into typed arrays, preserving sample order, missing values, and last-valid duplicate behavior without a second timestamp-keyed object.
- Verify worker scheduling, cancellation, paging, and prediction parity with the test suite and bundled frontend typecheck. Exercise a preserved Primarius snapshot (79,387 cards; 3,785,024 reviews) in Qt WebEngine, retaining graph results and refreshing synthetic predictions during calculation. Synthetic probabilities test allocations and integration, not model accuracy.
