# Daily recall gap and log loss

Two graphs follow **FSRS vs RWKV Card Retrievability**, in this order:

1. **Daily Recall Gap** compares actual daily recall with one or two selected
   models' average predicted recall, in percentage points.
2. **Daily Log Loss** shows mean binary log loss in bits per eligible review.

Both respect the Statistics search and review date range, and offer independent
moving-average and [drag-to-zoom](TIME_AXIS_ZOOM.MD) controls. Both graphs
offer FSRS, FSRS-6, RWKV (current), RWKV Big, RWKV Small Curve, RWKV Small Instant and
RWKV Tiny Instant in either position; the second model can be set to None. Each
defaults to FSRS and RWKV (current). The first model uses blue and the second
uses green.

Both graphs share the model prediction store with Model Calibration, UM+ and
ROC. Explicit RWKV models are prepared on selection and their predictions are
reused. Daily aggregates are computed in the statistics worker and shared by
the two daily graphs for the current sample; selecting a model does not start calibration bootstrap.
Preparation progress, source warnings, failures and retry remain visible. A
model without predictions shows a no-data message while another available model
can still be displayed. FSRS uses held-out cached predictions, not the calibration
graph's replay fallback. The default pair reuses existing daily comparison
results when available. No new persisted data or database operations are introduced.

## Daily recall gap

For each Anki day, **actual recall** is the fraction remembered among all graded
reviews in the search and date range. Again is forgotten; Hard, Good and Easy are
remembered. Same-day repetitions and filtered reviews count. Ungraded manual
entries do not count. Every selected model is compared with this same daily
actual rate.

For each model, **predicted recall** is the mean of its available eligible
review-time predictions on that day. Model predictions can cover fewer reviews
than the actual rate, and two models can cover different reviews. Calibration
eligibility and prediction provenance are described in
[the calibration data path](FSRS_CALIBRATION_GRAPH.MD). Missing or invalid
probabilities are excluded from the predicted mean.

The plotted value is `100 × (actual recall - average predicted recall)`.
Positive values mean the day's actual recall was higher than predicted; negative
values mean it was lower. Zero is the reference line. A day without any eligible
prediction for a model has no value for that model. Tooltips show the actual
rate and its total review count, the model's predicted rate and its prediction
count, and the gap. Mouse hover and keyboard focus expose the same information.

The vertical axis is symmetric around zero. Without a moving average, its extent
is the 95th percentile of the absolute visible daily gaps across selected models.
With the moving average enabled, its extent is 105% of the largest absolute
visible average. A zero or unavailable extent falls back to one percentage point.
Daily outliers outside the axis are clipped from the plot but remain in the date
tooltips. Zooming recalculates the extent from the visible days.

## Daily log loss

Each model uses its own eligible predictions and matching outcomes, independently
of the other model. A remembered review contributes `-log2(p)`; a forgotten
review contributes `-log2(1-p)`. The daily score is their mean, in bits per
eligible review. Its actual and predicted recall tooltip values describe those
same eligible reviews, not the all-review population used by Daily Recall Gap.

The score penalizes confident mistakes strongly, but even calibrated predictions
have positive expected loss when outcomes are uncertain; it is not a pure
calibration measure. The observed-outcome probability is floored at `1e-15`
only for the logarithm, capping a contribution at approximately 49.83 bits.
Raw probabilities remain unchanged for the recall rates.

## Moving averages

Each panel starts with a **7 calendar day** moving average and also offers study
days or a review-count window (initially 1,000). Calendar-day windows average
available daily values from the last N calendar days; study-day windows average
the last N available daily values. Both weight days equally. Missing days stay
empty. Optional dotted connectors interpolate across gaps without adding daily
values or tooltips.

For Daily Recall Gap, a review-count window contains the last N graded reviews
in the search, ending at the end of the plotted day. Actual recall uses all of
those reviews; a model's predicted mean uses the subset in that window for which
it has an eligible prediction. A model with no prediction in the window has no
average for that point. The same total-review window applies to both models.
Daily Log Loss instead uses each model's last N eligible predicted reviews and
their mean individual log loss. At the beginning of history, windows use all
available reviews until full.

With smoothing enabled, colored lines show the selected average and daily lines
and points are faint grey; the first model's grey line is solid and the
second is dashed in both graphs. Disable
smoothing to restore colored daily values. Averages are computed before zoom
crops the visible dates. Each panel's controls are local to the mounted view.

## Verification and runtime

`test/dailyRecallGap.test.ts` covers all-review daily recall, independent model
predictions and review-count windows. `test/dailyRecallGapComponent.test.js`
exercises model selection and reuse for both graphs. `test/dailyPredictionData.test.ts` and
`test/dailyPredictionGraph.test.ts` cover scoring, smoothing, labels, tooltips,
gaps, zoom and Daily Log Loss scoring.

Build with `npm run build`, package with `./package.sh`, and synchronize with
`./copy_to_anki.sh`. Python bridge changes require a full Anki restart.
