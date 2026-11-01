# Daily FSRS and RWKV recall gap and surprise

Two graphs follow **FSRS vs RWKV Card Retrievability** (which immediately follows
current Disagreement), in this order:

1. **Daily Recall Gap**: a choice of the signed standardized difference between
   actual and expected recalls or the raw difference in percentage points.
2. **Daily Surprise**: mean binary log loss in bits per eligible review.

Both respect the statistics search and review date range. Each panel has its own
**FSRS / RWKV / Both** selector, initially **Both**, independently of the ordinary
calibration source selector. FSRS uses blue; RWKV uses green.

Both panels support [drag-to-zoom](TIME_AXIS_ZOOM.MD) with a local **Reset zoom**
button. Both models share the selected dates, and smoothing uses full history
before cropping. Except for the raw recall-gap view described below, the vertical
axis fits both visible daily and averaged values.

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
Anki's rollover hour and each review date's local timezone offset.
Calendar labels preserve these day indices. Days without eligible predictions
have no daily value rather than being filled with zero. The optional gap
connectors described below do not add data for those days.
Tooltips show the date and, for each selected model with data on that day,
the graph score, actual R (`sum(y)/n`), predicted R (`sum(p)/n`), and eligible
review count. When smoothing is enabled, they also show the moving average. Hover and keyboard focus expose the
same information. No eligible data shows an explicit no-data message; the
existing prediction source's warnings are retained. The shared comparison worker
computes daily scores once history and both prediction stores are ready; the
panels show loading until the comparison result arrives. Daily scores use each model's eligible predictions independently, including
reviews absent from the other model's predictions.

## Daily recall gap

The panel initially displays the standardized gap. Enable **Show raw difference
(percentage points)** to switch to `100 * (actual R - predicted R)`. The raw
view remains available when predicted variance is zero. The selector is local to
the panel and does not change either model's data.

The standardized gap is:

`Z = sum(y - p) / sqrt(sum(p * (1 - p)))`

The variance uses each review's probability, not just the day's mean R.
Positive means more recalls than predicted; negative means fewer. Zero is a
dashed reference line. The vertical axis is symmetric around zero. In the raw
view, when the moving average is disabled, its extent is the 95th percentile of
the absolute visible daily gaps across the selected models (using linear
interpolation). With the moving average enabled, its extent is 105% of the
largest absolute visible moving average. A zero or unavailable extent falls
back to one percentage point. Daily values outside the axis are clipped from
the plot but remain available in the date tooltips. Zooming recalculates the
extent from the visible days.

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

Moving averages start enabled with a **7 calendar day** window in each panel.
The compact control also offers a window measured in **study days** with an
eligible score, or in **reviews** (initially 1,000). Calendar windows average
available daily scores in the last N calendar days; study-day windows average
the last N available daily scores, even when separated by missing dates. Both
give each included day equal weight, independently of its review count. In
the standardized view, a day whose predicted variance is zero is unavailable
and is excluded from a study-day average.

Review-count windows include each model's latest N eligible reviews, including
the part of a day at the beginning of the window when necessary. Raw recall
gap is `100 × sum(actual - predicted) / count`, and surprise is the mean of
the individual review losses. The standardized view instead computes one
window-level `sum(actual - predicted) / sqrt(sum(p × (1 - p)))`; it is not an
average of daily Z-scores. A window with zero total variance has no standardized
value. At the beginning of history, all available reviews are used until the
window fills. Because the models can have different eligible predictions, their
review-count windows can cover different dates. These windows are computed in
the statistics worker from the existing predictions without requesting new ones.

Disable **Moving average** to restore the colored daily lines. When enabled,
colored lines show the selected window and daily lines and points become faint
grey; FSRS's grey line is solid and RWKV's is dashed. **Connect missing days**
starts enabled and draws a faint dotted interpolation between available
averages; turning it off restores breaks. It never creates daily values or
tooltips for missing dates. A calendar-window average may change as older days
expire, so the connector between endpoints is an interpolation, not a
calculated value for every missing day. The selected window is calculated
before zoom crops the display. Controls are local to each panel and are not
persisted. The existing maturation graphs retain their own calendar-day behavior.

## Verification and runtime

`test/dailyPredictionData.test.ts` covers the scores, review-count scaling,
confidence, sparse/invalid data, boundary probabilities, and Anki day rollover.
`test/dailyPredictionGraph.test.ts` covers rendering, signed values, gaps, unavailable
scores, both gap views, review-count and study-day windows, both model series,
grey daily values, gap connectors, smoothing, redraws, raw-gap axis ranges and
clipping, and mouse/keyboard tooltip behavior. Calibration parity and loading tests verify each model's
independent eligible sample and the FSRS held-out boundary. Maturation regression
tests cover the reused averaging helper.

Build with `npm run build`, package with `./package.sh`, and synchronize with
`./copy_to_anki.sh`. When the Python bridge changes, fully quit and reopen Anki
before loading the updated graphs.
