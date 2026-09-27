# Daily RWKV recall gap and surprise

Two graphs follow **FSRS vs RWKV current Disagreement**, in this order:

1. **RWKV Daily Recall Gap**: signed standardized difference between actual and
   expected recalls.
2. **RWKV Daily Surprise**: mean binary log loss in bits per eligible review.

Both respect the statistics search and review date range. They reuse
`memorised_stats.calibration_samples` and
`rwkvCalibrationStats.predictionsByRevlogId`, independently of the calibration
source selector and without requiring matching FSRS predictions. Their input
eligibility and historical prediction provenance are the same as
[RWKV Calibration](FSRS_CALIBRATION_GRAPH.MD). No additional requests, stored
values, database operations, or runtime dependencies are introduced.

## Sample and daily grouping

Each sample contributes its pre-answer RWKV probability `p` and observed outcome
`y`: Again is 0; Hard, Good, and Easy are 1. Only finite probabilities in `[0, 1]`
and binary outcomes are accepted. Missing or invalid predictions are excluded
from both scores, both recall rates, and the review count. Existing calibration
eligibility excludes same-day repetitions and filtered-out calibration samples;
the role-aware source additionally excludes training/final-fit rows.

Reviews are grouped with the existing `dayFromMs(revlogId)` helper, including
Anki's rollover hour and the add-on's current timezone-offset convention.
Calendar labels preserve these day indices. Days without eligible predictions
have no value and break the plotted line, rather than being filled with zero.
Tooltips show the date, graph score, actual R (`sum(y)/n`), predicted R
(`sum(p)/n`), and eligible review count. Hover and keyboard focus expose the
same information. No eligible data shows an explicit no-data message; the
existing prediction source's loading state and warnings are retained.

## Daily recall gap

`Z = sum(y - p) / sqrt(sum(p * (1 - p)))`

The variance uses each review's probability, not just the day's mean R.
Positive means more recalls than predicted; negative means fewer. Zero is a
dashed reference line. The vertical axis is symmetric around zero.

The scale accounts for review count and predicted uncertainty. It assumes
independent outcomes, so correlated reviews and small samples prevent treating
it as an exact significance test. When the predicted variance is zero (all
predictions are 0 or 1), Z is undefined: omit the point and explain this in the
tooltip while retaining the day's recall rates, count, and log loss.

## Daily surprise

`L = mean(-log2(p))` for remembered reviews and `mean(-log2(1-p))`
for forgotten reviews, with both outcome types averaged together over the day.
Equivalently, take the mean negative log2 probability of each observed outcome.

This is an average, not a sum, so review volume alone does not increase it.
Unlikely successes and unlikely failures both contribute. Confident mistakes
are penalized strongly, but even calibrated predictions have positive expected
loss when outcomes are uncertain: the graph is not a pure calibration measure.

The probability of the observed outcome is floored at `1e-15` solely for the
logarithm, capping each contribution at approximately 49.83 bits. Certain correct
predictions contribute exactly zero. Raw probabilities remain unchanged for
the mean predicted R and variance calculation.

## Verification and runtime

`test/rwkvDailyData.test.ts` covers both formulas, review-count scaling,
confidence, sparse/invalid data, boundary probabilities, and Anki day rollover.
`test/rwkvDailyGraph.test.ts` covers rendering, signed values, gaps, unavailable
scores, redraws, and mouse/keyboard tooltip behavior.

Build with `npm run build`, package with `./package.sh`, and synchronize with
`./copy_to_anki.sh`. This changes frontend code and the English fallback locale;
reopening the statistics window loads the updated graphs.
