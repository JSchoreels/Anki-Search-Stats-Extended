# FSRS Stability Metrics

This document describes how stability-related values are computed for FSRS graphs.

## Average Stability Over Time

- Source: [`getMemorisedDays()`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/MemorisedBar.ts)
- Output fields:
    - `day_means`
    - `day_medians`
    - `day_young_ratio_s90`

### Semantics

- `day_means` and `day_medians` are computed from `S90`, not raw FSRS `stability`.
- `S90` is defined as the interval in days where retrievability is `90%`.
- Conversion uses Anki's backend batch API (`/_anki/fsrsS90Batch`) which calls:
    - `mw.col.fsrs_interval_at_retrievability_by_config_batch(...)`
- For performance, replay collects all candidate `(config_id, stability-bucket)` values first, resolves unique keys in one batch, then computes day stats from the recorded replay transitions.
- Request payload is deduplicated by `(config_id, stability)` with dynamic stability step:
    - `stability <= 10`: step `0.1`
    - `stability > 10`: step `0.5`
- `day_young_ratio_s90` stores the young-card ratio based on `S90 < 21`.

### Notes

- Raw `stability` values are still used in other places that need original FSRS state.
- This split avoids mixing display-oriented “stability over time” with raw state internals.
