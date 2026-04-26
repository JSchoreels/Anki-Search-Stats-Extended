# Ratings Distribution Data Path

This document describes the data used by:

- Rating Distribution by Retrievability
- Rating Distribution by Stability
- Rating Distribution by Repetitions
- Rating Distribution by Difficulty

## Source Data

- Computed in [`src/ts/revlogGraphs.ts`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/revlogGraphs.ts) inside `calculateRevlogStats()`.
- FSRS-backed buckets (retrievability/stability/difficulty) use pre-review FSRS state from the replay pass.
- Repetition buckets are computed per card in chronological revlog order.

## Returned Fields

- `grade_by_retrievability`
- `grade_by_retrievability_exclude_same_day`
- `grade_by_retrievability_success_only`
- `grade_by_retrievability_success_only_exclude_same_day`
- `grade_by_stability`
- `grade_by_stability_success_only`
- `grade_by_repetitions`
- `grade_by_repetitions_success_only`
- `grade_by_difficulty`
- `grade_by_difficulty_success_only`

Each bucket stores `[again, hard, good, easy]` counts (ease indices `0..3`).

For Rating Distribution by Retrievability, UI toggles can filter buckets to:

- exclude same-day reviews (`elapsed < 1`)
- include only successful answers (`ease > 1`, i.e. Hard/Good/Easy)

For Rating Distribution by Stability/Repetitions/Difficulty, UI can filter buckets to:

- include only successful answers (`ease > 1`, i.e. Hard/Good/Easy)
