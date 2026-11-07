# FSRS accuracy and performance benchmark

All four improvements are implemented:

1. The stability/retrievability heatmap reads Anki's native current FSRS
   prediction instead of estimating the last review from due date minus interval.
2. Historical Memorised points use the end of each local Anki day; today's point
   uses the current time. FSRS-7 retains fractional elapsed days, including DST.
3. Incomplete history starts from Anki's interval/ease bridge with the resolved
   historical retention and UTC history cutoff. The first retained grade is
   represented once. Resets end the previous state and cram entries are excluded.
4. Forgetting curves fit each resolved preset separately, then combine
   predictions in proportion to its review count. Model weights are not averaged.

## Precision against native Anki

These synthetic cases measure numerical agreement with native Anki, **not
prediction accuracy on future answers**. Errors are absolute probability
differences in percentage points: a prediction of 80% versus 82% has error 2.

| Case | Observations | Old mean error | Old maximum error | New mean error | New maximum error |
| --- | ---: | ---: | ---: | ---: | ---: |
| Current S×R heatmap | 10,000 cards | 2.08882 | 11.46572 | 0 | 0 |
| Incomplete-history initialization and replay | 36 cases | 2.71461 | 9.59892 | 0.00000513 | 0.00002439 |
| Daily Memorised snapshots | 3 cases | 3.63501 | 4.44336 | 0.00000567 | 0.00000818 |
| Mixed-preset curve | 6 intervals | 1.60581 | 1.92933 | 0.00000833 | 0.00001167 |

The current heatmap's zero error follows directly from using the native API
values. Both paths plot all 10,000 eligible synthetic cards. Due dates are
deliberately shifted to exercise the old estimate's sensitivity to rescheduling.

The incomplete-history cases use 17-, 19-, 21-, and 34-parameter presets,
intervals of 1/30/300 days, retention of 85%/90%/95%, legacy ease, an absent ease,
and FSRS-encoded difficulty. Each bridge is followed by three graded reviews.
The small remaining differences reflect native float32 versus JavaScript
arithmetic. The older 35-parameter preview was outside this native numerical
oracle and is no longer supported.

The daily cases exercise the spring DST transition, a review immediately before
rollover, and today's partial day. Additional tests cover the autumn 25-hour day,
multiple same-day reviews, cutoff selection, resets and resolved presets.

The mixture precision case compares a fixed 50/50 cohort at six elapsed times.
It holds initial fitted stability fixed to isolate the error caused by averaging
parameters. It does not measure optimizer quality; the performance benchmark
below runs the complete fitting pipeline.

## Performance

Times are milliseconds, measured on an Apple M1 Max with Node v20.11.1, arm64,
in Europe/Brussels. Each JavaScript workload has one warm-up per side and seven
timed pairs, alternating old/new execution order. Garbage collection occurs
before timing. The table reports medians; raw runs and maxima are preserved in
[FSRS_ACCURACY_BENCHMARK.json](FSRS_ACCURACY_BENCHMARK.json).

| Workload | Size | Old median | New median |
| --- | ---: | ---: | ---: |
| Heatmap processing | 1,000 cards | 2.60 | 0.72 |
| Heatmap processing | 10,000 cards | 25.34 | 6.87 |
| Curve fitting | 1,000 review samples | 264.42 | 31.48 |
| Curve fitting | 10,000 review samples | 2,702.77 | 56.20 |
| 180-day Memorised, 12 reviews/card | 1,000 cards | 248.26 | 254.99 |
| 180-day Memorised, 12 reviews/card | 10,000 cards | 2,416.81 | 2,600.14 |
| 165-day Memorised, missing learning history | 1,000 cards | 212.13 | 232.33 |
| 165-day Memorised, missing learning history | 10,000 cards | 2,212.05 | 2,360.05 |
| Native metrics and resolved presets | 1,000 cards | 8.42 | 8.67 |
| Native metrics and resolved presets | 10,000 cards | 92.26 | 90.19 |

Curve fitting is about **48× faster** at 10,000 samples in this workload. When
opening a forgetting curve or changing its fitting controls, processing drops
from about 2.70 seconds to 0.06 seconds. The fit reuses compiled predictors and
groups repeated rating/elapsed-time observations while preserving the binary
log-loss and existing prior. Samples span four first ratings, two presets and
90 repeated intervals. Data with mostly unique elapsed times or many sparse
presets can have smaller gains.

Heatmap processing saves about 18 ms at 10,000 cards, a small practical change.
The new native data request is shared with review-history and Memorised stats.
For a page displaying only current miscellaneous graphs, this request adds work
that the old heatmap did not need. Native metrics/preset resolution takes about
90 ms for 10,000 cards here, excluding serialization and transport. The backend
comparison uses the existing batch warm-up/per-card preset path, which already
computed the metrics, versus retaining its native R values; those times are
effectively unchanged within run variation.

At 10,000 cards, accurate historical replay costs about **184 ms (7.6%)** for
complete history and **148 ms (6.7%)** for incomplete history. These calculations
run in the stats worker. Timing is computation only, excluding worker startup,
message serialization, rendering and database history retrieval. Peak memory
was not measured.

## Reference and reproduction

The old frontend source is commit
`851c1ca1a48053a0b1840e3932b9f4e614c25b2f`. The benchmark bundles the actual old
and new source independently rather than recreating either implementation.
Native FSRS uses Anki's pinned fsrs-rs revision
`4bc0a0979f95dd01cc653031b6f2a01429e4c32b` from the local Anki checkout.
The encoded-difficulty rescaling in the oracle follows Anki's
`scheduler/fsrs/memory_state.rs`; history-selection tests follow
`scheduler/fsrs/params.rs::reviews_for_fsrs(training=false)`.

Tooling lives in `benchmark/`. The native API script creates a disposable
synthetic collection through supported Anki APIs. It does not open a user
profile or issue direct SQL. Native oracle requests contain only synthetic
states and review sequences. The frontend timestamp is frozen to
2026-10-04 15:23 in Europe/Brussels; the API fixture records native predictions
when the disposable collection is generated.

To rerun, extract the baseline commit to a temporary directory, make the
repository's existing dependencies available to it, and use the paths to a
built Anki Python binding and the pinned fsrs-rs source:

```sh
rtk proxy python3 benchmark/build-native.py /path/to/pinned/fsrs-rs /tmp/sse-native-oracle
rtk proxy env PYTHONPATH=/path/to/anki/pylib:/path/to/anki/out/pylib python3 benchmark/native-api.py /tmp/sse-native-api.json
rtk proxy env TZ=Europe/Brussels node --expose-gc benchmark/fsrs.mjs /tmp/sse-baseline /tmp/sse-native-oracle/target/release/sse-native-oracle /tmp/sse-native-api.json /tmp/sse-fsrs-benchmark.json
```

The benchmark also regenerates `test/fixtures/fsrs-native-reference.json`.
Run it without another build or test workload competing for CPU time.

## Verification and remaining limits

At the time of the benchmark, the main checkout passed 281 tests; the combined
checkout, including the other chat's graph changes, passed 291. Both passed
build/typecheck. The bundled worker passed FSRS-7 same-day replay/calibration/ratings
and 17/19/21/35-parameter compatibility checks; the 35-parameter preview is no
longer supported. Python endpoint checks verify omitted missing predictions,
complete-preset deduplication, and empty searches. Updated Fluent resources
parse. Browser checks verify asynchronous native heatmap loading, logarithmic
redraw, the mixed-preset legend, and interval-control redraw using real components
with synthetic inputs.

Incomplete-history initialization remains an estimate, as it is in Anki.
Deleted reviews and past preset changes cannot be recovered exactly. Older
models retain their existing scalar S90 bucketing; FSRS-7 uses full state.
Curve mixture weights are fixed for each rating's cohort, so changes in preset
composition by elapsed-time bin can still differ from the plotted pooled points.
These benchmarks do not verify a live collection's graph totals or prove improved
predictive calibration. RWKV history remains supplied by its native backend.
