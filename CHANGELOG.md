# Changelog

## Unreleased

- Prepare historical FSRS calibration automatically when eligible FSRS statistics load. Reuse completed history and refresh both model caches after preparation.
- Keep cached graphs available during generation. Preserve native progress and Cancel; a cancelled or failed job retries when Statistics is reopened.
- Remove the test-build diagnostic panel, full-history replay override and Generate button.
- Add Export troubleshooting info beside Save PDF, with a Support-area fallback when the native button cannot be installed. Save aggregate calibration counts, date ranges, model sources, generation status and Anki environment details as a text file.
- Identify unloaded data in troubleshooting exports instead of reporting misleading zero counts. Cancelling export writes no file.
