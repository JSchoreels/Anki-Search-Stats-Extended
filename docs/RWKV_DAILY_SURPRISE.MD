# Daily FSRS and RWKV recall gap and surprise

Two graphs follow **FSRS vs RWKV Card Retrievability** (which immediately follows
current Disagreement), in this order:

1. **Daily Recall Gap**: signed standardized difference between actual and
   expected recalls.
2. **Daily Surprise**: mean binary log loss in bits per eligible review.

Both respect the statistics search and review date range. Each panel has its own
**FSRS / RWKV / Both** selector, initially **Both**, independently of the ordinary
calibration source selector. FSRS uses blue; RWKV uses green.

Both panels support [drag-to-zoom](TIME_AXIS_ZOOM.MD) with a local **Reset zoom**
button. Both models share the selected dates, the vertical axis fits visible
daily and averaged values, and smoothing uses full history before cropping.

The shared comparison worker reuses the calibration samples and each model's
index-aligned prediction array. FSRS uses the same held-out cached predictions
as UM+ and ROC; the calibration graph's replay fallback is excluded. RWKV uses
its existing eligible historical predictions. Each model includes its own available
predictions, without requiring a matching prediction from the other model. This
means daily review counts and actual recall rates can differ between models.
A model without eligible predictions shows an explicit no-data message while the
other model remains visible. No additional requests, stored values, database
operations, or runtime dependencies are introduced.

## Sample and daily grouping

Each model's sample contributes its pre-answer probability `p` and observed outcome
`y`: Again is 0; Hard, Good, and Easy are 1. Only finite probabilities in `[0, 1]`
and binary outcomes are accepted. Missing or invalid predictions are excluded
from both scores, both recall rates, and the review count. Existing calibration
eligibility excludes same-day repetitions and filtered-out calibration samples;
the role-aware source additionally excludes training/final-fit rows. Prediction
provenance follows [the calibration data path](FSRS_CALIBRATION_GRAPH.MD).

Reviews are grouped with the existing `dayFromMs(revlogId)` helper, including
Anki's rollover hour and the add-on's current timezone-offset convention.
Calendar labels preserve these day indices. Days without eligible predictions
have no value and break the plotted line, rather than being filled with zero.
Tooltips show the date and, for each selected model with data on that day,
the graph score, actual R (`sum(y)/n`), predicted R (`sum(p)/n`), and eligible
review count. When smoothing is enabled, they also show the moving average. Hover and keyboard focus expose the
same information. No eligible data shows an explicit no-data message; the
existing prediction source's warnings are retained. The shared comparison worker
computes daily scores once history and both prediction stores are ready; the
panels show loading until the comparison result arrives. Daily scores use each model's eligible predictions independently, including
reviews absent from the other model's predictions.

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

## Moving average

Moving averages start enabled with an editable **7-day** window in each panel.
Disable **Moving average** to restore the colored daily lines. When enabled,
the colored lines show the trailing mean of available daily scores over the
selected calendar-day window, and daily lines and points become faint grey.
FSRS's grey line is solid; RWKV's is dashed. The legend identifies the colored
model averages. A one-day window equals the raw scores.

Each available day has equal weight, independently of its review count. Missing
days and unavailable recall-gap scores are excluded from the mean and remain
line breaks. At the beginning of the range, only available earlier days in the
window contribute. The same shared trailing-average helper also supplies the
existing maturation graph's moving averages; maturation ratios continue to use
the ratio of counts over the same window. These controls are local to each panel
and do not persist settings or request new predictions.

## Verification and runtime

`test/dailyPredictionData.test.ts` covers both formulas, review-count scaling,
confidence, sparse/invalid data, boundary probabilities, and Anki day rollover.
`test/dailyPredictionGraph.test.ts` covers rendering, signed values, gaps, unavailable
scores, both model series, grey daily values, smoothing, redraws, and mouse/keyboard
tooltip behavior. Calibration parity and loading tests verify each model's
independent eligible sample and the FSRS held-out boundary. Maturation regression
tests cover the reused averaging helper.

Build with `npm run build`, package with `./package.sh`, and synchronize with
`./copy_to_anki.sh`. This changes frontend code and the English fallback locale;
reopening the statistics window loads the updated graphs.
