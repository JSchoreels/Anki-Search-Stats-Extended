# Changelog

## Unreleased

### User facing changes

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
