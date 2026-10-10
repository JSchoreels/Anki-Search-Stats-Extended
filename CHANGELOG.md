# Changelog

## Unreleased

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

## 2026-10-10

### User facing changes

- Reduce memory use when loading UM+ and FSRS graphs for large collections, including when newly generated predictions refresh during Memorised replay. Full review history remains included. Graph calculations run in sequence, so refreshed graphs may appear later.
- Keep Anki responsive while calibration completion fingerprints are checked, and retry interrupted FSRS generation when only some validation batches were saved.

### Technical details

- Fetch review history in pages of 25,000 rows and transfer eight numeric columns to workers. Retain daily S90 transitions instead of every FSRS-7 request state.
- Serialize all statistics workers, including prediction parsing, bands, and comparisons. Merge prediction rows directly into typed arrays, preserving sample order, missing values, and last-valid duplicate behavior without a second timestamp-keyed object.
- Verify worker scheduling, cancellation, paging, and prediction parity with the test suite and bundled frontend typecheck. Exercise a preserved Primarius snapshot (79,387 cards; 3,785,024 reviews) in Qt WebEngine, retaining graph results and refreshing synthetic predictions during calculation. Synthetic probabilities test allocations and integration, not model accuracy.
