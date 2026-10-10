# Statistics loading

The stats page fetches card data once for each search. Interval histograms use
those cards (review and relearning types), excluding queue -1 when suspended
cards are hidden. Toggling suspended cards does not issue another graphs request.

Review history is fetched in pages of at most 25,000 rows, using the final
review ID as an exclusive cursor. Every page retains the same card selection
and history cutoff. An obsolete search stops fetching further pages. Pages
are converted and discarded as they arrive, avoiding a single full-history
JSON response alongside the final history. Each page is converted to eight numeric
columns, then concatenated into one packed `Float64Array`.

Review-history aggregation, FSRS Memorised history, calibration response parsing,
prediction alignment, calibration bins/bootstrap, and UM+/ROC/RWKV daily
calculations run in dedicated worker tasks. The shared `statsTasks.ts` dispatcher
also serves tests. Workers receive review history as eight numeric columns in a
transferred `Float64Array`, preserving timestamp IDs and signed intervals without
cloning millions of objects. The page retains packed history and transfers a copy
of its buffer, so later tasks can still use it. Workers wrap that buffer without
unpacking rows. `RevlogHistory` iteration borrows one reusable cursor; callers
must copy numeric fields if they retain a row. Replay groups retain row indices,
selection/reset flags use bytes, and per-review stability uses a numeric column.
Replay and cheap calibration selection share the same reset/cutoff/cycle rules;
only replay computes missing-history starting states. Chronological history
needs no global sort; shuffled histories and duplicate timestamps retain stable
legacy replay ordering. All statistics tasks share one queue, including
prediction parsing, confidence bands, and comparisons. Calibration selection
takes priority; queued aggregation and prediction tasks precede Memorised replay.
A prediction refresh that arrives during replay waits for it to finish. This
prevents newly generated caches from starting additional large worker heaps
while replay is running, at the cost of delaying refreshed graphs.
Cancelling a queued task removes it before any worker or transfer is created.
Calibration samples use index-aligned `Float64Array` review
and card IDs, `Uint8Array` outcomes, and `Float64Array` predictions (`NaN` for
missing values). The page sends raw response text to the worker and receives
aligned predictions and compact graph results. Prediction parsing checks whether response rows and sample IDs are chronological,
using their existing order when possible. Shuffled inputs are sorted before
merging into a `Float64Array`, retaining
last-valid duplicate semantics without a timestamp-keyed object copy. This avoids cloning large
object arrays/maps and parsing prediction JSON on the main thread. Changing the search or history range terminates obsolete
workers and ignores obsolete endpoint responses. Worker failures are reported;
they do not fall back to blocking the page.

Calibration samples are selected in a cheap worker independently of the full
Memorised replay. Last-forget markers come directly from review history, so
Memorised replay also starts without waiting for review-history aggregation.
With `autoMemorisedStats` disabled, Calculate on calibration, UM+, ROC or RWKV
daily panels enables review and comparison loading without starting the separate
historical Memorised replay. Memorised/history panels keep their own Calculate
action, which requests that replay. The existing `autoMemorisedStats` preference
still requests it automatically. RWKV historical replay is likewise gated on the
Memorised request and selected historical source. Once requested, history remains
enabled for subsequent searches in that stats page.
Each calibration line appears as soon as its cache predictions and bins are
ready; card-bootstrap confidence bands arrive separately. Comparison calculations
reuse the same predictions when bands arrive. Only an empty FSRS cache waits for
Memorised replay, requesting it if needed and aligning its predictions to the
selected review IDs. Confidence bands consume numeric samples through a borrowed
observation and aggregate by card/bucket immediately; they do not retain an
observation object per review. The 500 deterministic bootstrap iterations and
card-cluster weighting are unchanged.

Historical FSRS calibration preparation starts automatically once eligible
history loads. Ordinary Statistics loads read caches immediately while preparation
runs. FSRS and RWKV cache reads are independent, so RWKV is available while FSRS
training is pending. Comparison graphs show loading until both cache results and
their comparison worker result are ready; RWKV daily calculations still use all
eligible RWKV predictions, without requiring paired FSRS predictions.
The generation job runs as a serialized Anki background operation with native
cancellable progress. Ordinary presets resolve once per home deck and use short
native preset searches. Overlay routing retains exact per-card settings, with
one native batch resolver preparation and cached home-deck options. Explicit
repeat preparation checks historical-prefix hashes and cache coverage to reuse
completed work. After completion, both graph caches refresh and RWKV checks
held-out coverage against FSRS. See
[FSRS calibration generation](FSRS_CALIBRATION_GRAPH.MD) for metadata and
compatibility behavior.

Anki's pending-RWKV graph retries reuse SSE's current search data until RWKV is
ready; RWKV calibration then reloads any newly available predictions. This reuse is limited to a pending response with the same search, native
history range, and SSE all-time setting in the same page. An ordinary refresh
loads fresh data. Searches using RWKV properties always reload because their
matching cards may change when scores become available.

FSRS preset loading first prepares the native batch resolver using
`card_memory_metrics(..., include_retrievability=True)`, then reads resolved
presets per card. This avoids repeated cold search preparation. The endpoint
returns `{presets: [...], cards: {cardId: presetIndex}, retrievability: {cardId: R}}`,
deduplicating complete settings rather than preset ids so deck/card overrides
remain intact. The returned native R values are reused by the S×R heatmap;
missing native predictions are omitted. The shared frontend result serves the
heatmap, review-history aggregation and Memorised replay. It is loaded when
review-history stats or the miscellaneous graph category need it. Obsolete
search results are ignored; unrelated category toggles do not reload it.

Each stats window owns one page-load callback. Refresh replaces that callback
and continues to read rebuilt JavaScript/CSS from disk. `npm run build` produces
both `stats.min.js` and `stats-worker.js`; packaging and installation must include
both. The worker is served by Anki's add-on media endpoint on the same origin.
After installing Python changes, fully quit and reopen Anki.

Precision/performance measurements and reproducible synthetic inputs are in
[FSRS_ACCURACY_BENCHMARK.MD](FSRS_ACCURACY_BENCHMARK.MD). Runtime measurements
separate backend metrics/preset resolution from frontend graph processing.

## Large-collection regression verification

The October 2026 memory regression uses an offscreen Qt WebEngine 6.11.2
page against a preserved collection copy with 79,387 cards and 3,785,024 review
rows. An initial check completed with serialized full-history tasks, but discarded
large graph results and did not refresh predictions during replay. It therefore
missed the subsequent live-profile failure. The expanded regression retains
review and Memorised results as the page stores do and requests a second set of
predictions three seconds after review aggregation completes. This reproduces
V8 `CALL_AND_RETRY_LAST` OOM with the history-only queue.

Serializing alone still ran out of memory in prediction parsing with retained
graph results. Compact prediction alignment removes that second large copy.
Both changes are checked against the same refresh sequence, including
selection of 1,518,677 calibration samples, both prediction parsers, both
confidence-band calculations, UM+/ROC/RWKV daily comparison, review aggregation,
and full FSRS Memorised replay. Prediction payloads use synthetic probabilities
at the real sample count; each response must cover all selected IDs. A second
refresh is triggered three seconds after Memorised replay actually starts and
completes after its retained result arrives. This checks allocation and task
integration, not the accuracy or coverage of the live profile's model caches.
An additional stress case with 3,515,138 response rows still ran out of memory
after replay. The actual endpoints are requested with selected review IDs,
limiting each response to 1,518,677 rows for this snapshot; larger selected
cohorts are not established by this regression. No live collection is
opened or modified by this test.

Regression tests cover cursor boundaries and card/date filtering using a
synthetic SQLite endpoint fixture, cancellation between pages and in the queue,
transferred timestamp/interval precision, stats task ordering, prediction refresh during replay, and failure
recovery, and equivalent local/batch daily S90 results across resets and
same-day reviews. Run `npm test -- --runInBand --coverage=false` and
`npm run build` before packaging both frontend bundles.


## Packed-history and demand-loading measurements

The further October 10 improvements were compared with add-on commit `1b100ed`
in the same Qt WebEngine 6.11.2 workload described above. Both runs retain all
history/Memorised results, complete full replay, and refresh both synthetic
prediction responses during replay. Lazy Memorised loading is deliberately not
used in this stress sequence, so the memory comparison exercises all graphs.

| Measurement | Before | After |
| --- | ---: | ---: |
| Peak renderer RSS | 5,350,384 KiB (5.10 GiB) | 3,886,048 KiB (3.71 GiB) |
| Whole sequence | 170.490 s | 158.059 s |
| Review aggregation | 38.795 s | 34.632 s |
| Memorised calculation | 69.051 s | 67.505 s |
| Selected calibration reviews | 1,518,677 | 1,518,677 |
| Outlier exclusions | 20,788 | 20,788 |

Renderer RSS is sampled with `ps -p <page.renderProcessPid()> -o rss=` every
250 ms; it includes the page and worker memory, not the Python backend process.
Whole-sequence time includes loading and all three prediction/comparison/band
rounds. These are single before/after runs; timing and RSS vary between runs.
Peak RSS falls by 27.4%; whole-sequence time falls by 7.3%. The small Memorised
CPU gain does not materially change its wait by itself. Demand-loading avoids
that separate calculation when only comparison/calibration graphs are requested,
unless automatic loading is enabled or an empty FSRS cache needs replay.

Verification includes 398 tests, pinned native FSRS accuracy cases, frozen
object-based replay ordering/selection parity for mixed FSRS-6/7 presets and
shuffled/duplicate histories, and deterministic calibration/bootstrap parity.
An offscreen Svelte/Qt button smoke confirms that calibration Calculate enables
comparison loading while the Memorised Calculate button remains available, and
that clicking the latter requests history. Store tests cover automatic loading,
empty-cache fallback, RWKV demand gating and obsolete-response cancellation.
