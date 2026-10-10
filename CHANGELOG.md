# Changelog

## Unreleased

### User facing changes

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
