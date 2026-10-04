# Forgetting Curve Data Path

## Model and sample rules

Review/card data is processed in `src/ts/revlogGraphs.ts`. Each card uses its
Anki-resolved FSRS preset from `fsrsPresetData`, including deck/card overrides
and the original home deck for filtered cards. Isolated calculation callers
without resolved presets use their supplied deck configuration; cards without
a configuration use their own decay value. A selected parent deck does not
replace subdeck presets.

The long-term model (`forgetting_curve_long_term_model`) covers long-term sample
cards. The short-term model (`forgetting_curve_short_term_model`) also covers
cards that have only short-term samples. Single-preset searches retain the
scalar/parameter-array model representation. Mixed searches return distinct
models plus a card-to-model index. Parameter arrays are never averaged, and
minority model versions are retained.

## Fitting and display

For each first-rating series, fit a separate first-review state for each preset
using that preset's review samples. FSRS-7 preserves its initialized fast/slow
trace ratio and rating-specific difficulty. Fitting scales both traces together;
it does not borrow an evolved learned-card state.

The displayed prediction line is the sample-count-weighted mean of those
independent predictions at each interval. The legend identifies multiple
presets and labels stability as an average fitted value. RMSE evaluates each
individual sample against its own preset's fitted prediction, then combines
squared errors. Observed points retain their existing bin/filter behavior;
fitting continues to use the original samples, as before.

Short-term samples and displayed fitted stability use minutes. The evaluator
converts elapsed time and fitted stability to days. Fitting, RMSE and rendering
share the same model/units. A fixed cohort mixture does not adjust preset
weights separately at each observed interval; changes in the sampled preset
mix across intervals can still affect agreement with pooled observed points.

## Performance

Compile each rating's model once per fitting job. Aggregate repeated
rating/interval observations into count and success sums before evaluating
binary log loss. This preserves the fitting objective while reducing repeated
model initialization and evaluation. The bootstrap starting-state cache and
curve-model grouping are scoped to the current calculation.
