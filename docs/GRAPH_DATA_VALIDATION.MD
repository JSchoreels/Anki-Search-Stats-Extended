# Graph Data Validation

## Rules for comparable values

Before comparing graphs, match their search, suspended-card setting, history
window, model, and eligible population. Current-card histograms count cards;
rating/calibration histograms count reviews. The current FSRS/RWKV comparison
requires both predictions and assigns each card once using the selected model.
Its total can be lower than a native single-model histogram.

- Keep histogram totals equal to the eligible input count, including exact
  boundaries and constant-value datasets.
- Match a prediction sum with the count of cards that contributed predictions.
- Calculate a displayed mean or median from its individual review samples.
  Normalize displayed percentages after combining the displayed range.
- Treat zero-time rated answers as reviews and zero-rating scheduling entries
  as scheduling events. Avoid zero denominators in empty searches.
- Read Unix due timestamps as seconds and use filtered cards' original due dates.
- Retain fixed percentage domains when sparse data has no high-value buckets.
- Apply the latest historical state through today, even with one review day.
- Distinguish display S90, internal stability, and full FSRS-7 memory state.

## Coverage

| Graph family | Data and checks |
| --- | --- |
| FSRS/RWKV current retrievability and disagreement | Supported backend FSRS memory metrics, paired eligibility, native float32 percentage boundaries, unique cards, selected model, shift ordering, tooltip local/search totals |
| Memorised, average stability, young-card ratio, calibration, loss, lapse odds | Complete FSRS replay state, resolved presets, reset and cram handling, review filters, latest-day coverage, calibration sample eligibility |
| ROC, UM+, RWKV daily surprise | Paired predictions, tied ROC thresholds, AUC, shared error buckets, sample counts, zero-variance and missing-day handling |
| Future Due and Future Due Retention | Eligible card type/queue, original due field, timestamp units, full model state, matched pass/fail totals |
| Interval, lapse, repetition, load | Current-card eligibility, suspended/zero settings, histogram/load totals, numeric interval boundaries |
| Ratings and fatigue | Rated-answer counts, zero-time answers, manual entries, subgroup totals, normalized empty buckets, fixed retrievability axis |
| Time distributions | Time units, review filters, source buckets, weighted means, true medians, redraw after width/statistic changes |
| Review speed | Native daily counts and times, empty-day denominators |
| Time Machine and hourly breakdown | Scheduling transitions, current suspended segments, selected history window, local calendar date/hour, exact day range |
| Stability/retrievability heatmap | Card eligibility, S90 versus internal state, finite probabilities, constant-value dimensions, count conservation |
| Stability increase factor | Full memory state, retention target, valid minimum stability, multiplier axis and tooltip units |
| Custom charts and Today's Retention | Search-defined populations and metrics; empty retention denominator |
| Shared rendering/trends | Sparse data, stack/legend order, hidden rows, ratios, cumulative values, trend coordinate ranges and persistence |

Use the established Jest suite and build/typecheck commands. Reproduce suspected
calculation issues with domain values, then add regression cases in the relevant
existing test file. Exercise UI changes with the actual components when a unit
check cannot establish reactive redraw or tooltip behavior.

## Practical limits

Historical replay uses the loaded history and available presets. Missing history
or past preset changes can prevent reconstructed values from matching persisted
current state. Calibration may use cached backend predictions instead of replay.

The S×R heatmap estimates elapsed time from due date minus interval; manual
rescheduling can make that estimate differ from the authoritative current R used
by the comparison chart. Some replay distributions use internal stability,
whereas the average stability and current card metrics use S90; these quantities
can differ under FSRS-7.

The general historical daily axis still captures one timezone offset at load.
Local hourly grouping uses each review's calendar date and hour. Daily values
near daylight-saving/rollover boundaries are a remaining verification area.

The automated fixtures and browser checks do not establish exact totals for a
live collection. Compare those totals only after matching the populations and
reloading the installed add-on.
