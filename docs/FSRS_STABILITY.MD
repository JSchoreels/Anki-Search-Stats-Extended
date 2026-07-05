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
- Historical replay stores the raw `ts-fsrs` internal stability after each review, then computes S90 locally from the resolved preset params already read through `/_anki/fsrsPresetData`.
- This avoids an additional backend S90 conversion request while preserving Anki's dynamic preset overlay resolution for the FSRS params used in the conversion.
- Replay records each card's resolved S90 after review, then computes day stats from the recorded replay transitions.
- `day_young_ratio_s90` stores the young-card ratio based on `S90 < 21`.

### Notes

- Raw internal stability values are still used in places that need original
  FSRS state. Current card data reads those values from `card.data.s_int`, with
  fallback to `card.data.s` for older collections.
- This split avoids mixing display-oriented “stability over time” with raw state internals.
- For current persisted card data, Anki stores `card.data.s` as S90 and `card.data.s_int` as internal stability.
- The Ease Factor graph reads current `card.data.s_int` and `card.data.d` from
  Anki, then passes that state to `ts-fsrs` to estimate the next Good-review
  stability gain.
- Anki may persist FSRS stability values below the current `ts-fsrs` `S_MIN` floor. The graph treats values down to Anki's `0.0001` stability minimum as valid input, but raises them to `ts-fsrs` `S_MIN` before calling `next_state()` so a low-stability card does not abort graph rendering.

## Average Stability Over Reps

- Source: [`getMemorisedDays()`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/MemorisedBar.ts)
- Output field:
    - `average_stability_by_reps`
    - `average_interval_by_reps`

### Semantics

- Cards are grouped by current `CardData.reps`, matching Anki's `prop:reps` value.
- The default stability view stores the mean current `S90` from `card.data.s`.
- The interval view stores the mean current positive `CardData.ivl`.
- Cards without a positive finite value for the selected metric are not included in that mean.

### Notes

- The stability view intentionally uses `S90`, not raw FSRS stability.
- It is a current card-data graph, not a replayed review-history graph.
