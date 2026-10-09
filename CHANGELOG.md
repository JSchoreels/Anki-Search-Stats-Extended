# Changelog

## Unreleased

- Keep calibration completion fingerprints off Qt's main thread and allow progress updates while a cache-reuse query waits for the collection.
- Retry interrupted FSRS generation even when Anki saved some validation batches before cancellation.

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
