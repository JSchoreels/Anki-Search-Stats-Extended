# Statistics loading

The stats page fetches card data once for each search. Interval histograms use
those cards (review and relearning types), excluding queue -1 when suspended
cards are hidden. Toggling suspended cards does not issue another graphs request.

Review history is fetched in pages of at most 25,000 rows, using the final
review ID as an exclusive cursor. Every page retains the same card selection
and history cutoff. An obsolete search stops fetching further pages. Pages
are converted and discarded as they arrive, avoiding a single full-history
JSON response alongside the final history. The history owner worker fetches and
converts pages to eight typed columns and concatenates each column once.
Timestamp review/card IDs use `Float64Array`; grades and review types use
`Uint8Array`; signed intervals use `Int32Array`; answer time and factor use
`Uint32Array`. This follows Anki's native field widths, using 34 bytes per review
instead of 64. Decoding rejects values that would truncate or wrap, rather than
silently changing a review. The page retains only its count and last-forget metadata in a
`StatsHistory` handle.

Review-history aggregation, FSRS Memorised history, calibration response parsing,
prediction alignment, calibration bins/bootstrap, and UM+/ROC/RWKV daily
calculations run in dedicated worker tasks. The shared `statsTasks.ts` dispatcher
also serves tests. Calibration selection, review aggregation and Memorised run
against the same worker-owned history. After each history task returns, including
a calculator error, the page transfers all eight backing buffers immediately to a fresh
owner worker and terminates the completed worker. This releases temporary
calculation heaps without retaining or copying the full history on the page.
Ownership transfers preserve timestamp IDs and signed intervals. Workers wrap
the columns without unpacking rows. Local callers can still supply packed history
or review arrays; those callers retain their input and transfer a task copy. `RevlogHistory` iteration borrows one reusable cursor; callers
must copy numeric fields if they retain a row. Legacy Float64 rows are read through
shared strided views without repacking. Replay groups retain one `Uint32Array`
of indices with per-card offsets, preserving first-seen card order. Learning
cycles use views into each group instead of growing/copied arrays. Selection
runs in a separate frame so grouped indices are released before numerical replay;
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
Cancelling an active graph rejects its public promise immediately but retains
queue ownership until the history worker completes and returns its buffers; the
result is discarded. Changing the search, history range, or closing its store
subscription aborts the history lifetime and terminates its owner immediately,
including during loading or calculation. A replacement search starts a new
owner. Fatal worker/transport errors dispose the owner and release the queue;
ordinary calculator errors preserve history for a later task.
Calibration samples use index-aligned `Float64Array` review
and card IDs, `Uint8Array` outcomes, and `Float64Array` predictions (`NaN` for
missing values). Selection and Memorised replay collect samples in 16,384-row
numeric chunks, copy into exact-size result columns once and release the chunks.
They do not retain three or four growing JavaScript arrays alongside the results. The page transfers each unread FSRS/RWKV prediction body stream to its queued
worker. The endpoint yields response-wide metadata, pages of at most 25,000
ordered rows, and a completion marker in one HTTP request. The worker parses
one page at a time and merges directly into aligned values; it does not retain a
full JSON string and parsed cohort together. Last-valid duplicates remain valid
across pages, and completion/count checks prevent partial results. Full JSON is
accepted for compatibility with a Python module still running before restart;
that parser skips sorting ordered rows and sorts shuffled rows when needed.
Changing the search aborts the response fetch and terminates obsolete workers.
Worker failures are reported; they do not fall back to blocking the page.

Workers transfer their result-owned typed buffers to the page instead of
structured-cloning them. Buffers shared by multiple views or graph filters are
transferred once, retaining aliasing. Time distributions retain one numeric
duration buffer shared by overlapping FSRS filters and compact grouped review
indices; exact means/medians and merged-bar controls use those values. Repetition
samples use the same representation, including the private retrievability and
stability samples inside review aggregation. Daily Memorised S90 transitions
retain exact card/key pairs in numeric chunks, with an index map for only the
current day. Same-day updates preserve first-seen card order and the final state
or reset; chunks are released after daily statistics. ROC integrates AUC over
every distinct threshold while retaining only plotted points at the existing
one-per-thousand axis resolution and the final endpoint. ROC confidence intervals allocate six
accumulators by eligible card count, preserving the existing card-clustered
DeLong calculation and its summation order.

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
observation object per review. Card/bin sums and counts use dense numeric chunks
for the fixed bin set, followed by compact per-card contribution ranges. The
collection frame ends before resampling, releasing its card map and counters.
The 500 deterministic bootstrap iterations, first-seen card/draw order, per-bin
summation order and card-cluster weighting are unchanged.

Current-card disagreement uses a separate transient snapshot from historical
calibration. Selecting an explicit RWKV model warms an isolated native runtime
from the complete collection history and then scores the searched cards in
batches; Curve scores use per-card queries. These jobs run in the background and
are serialized with explicit-model review-prediction replays to limit concurrent
native runtimes. Only selected models are prepared, completed scores are reused
for the open search, and changing the search or removing a loading model cancels
its obsolete job. They do not start calibration bootstrap or Memorised replay.

Historical FSRS calibration preparation starts automatically once eligible
history loads. Ordinary Statistics loads read caches immediately while preparation
runs. FSRS and RWKV cache reads are independent, so RWKV is available while FSRS
training is pending. The default FSRS/current-RWKV comparisons show loading until
both cache results and their worker result are ready; other model pairings wait
only for their selected sources. RWKV daily calculations still use all
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
`card_memory_metrics(..., include_retrievability=True)` when available, then reads
resolved presets per card. This avoids repeated cold search preparation. Fork
builds before 91, including portable build 88, lack that API; SSE uses
`card_stats_data(card_id)` per card to read the native `fsrs_retrievability`
instead. Capability detection also supports older forks independently of their
version string. This fallback loads full Card Info, including review history,
and is slower on large searches. It retains Card Info's native initialization
of missing last-review timestamps and reviewed-card memory state. Values absent
from Card Info remain omitted, and zero retrievability remains a valid value.
An empty search calls neither metrics API. Errors from an available batch API
are propagated rather than hidden by fallback. The endpoint
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


## Compact time results and streamed predictions

The next four improvements were measured against commit `890615d` in a fresh
run of the same retained-result Qt workload: exact compact time samples,
transferred worker result buffers, streamed prediction pages, and card-sized ROC
confidence accumulators. Both runs process 3,785,024 review rows for 79,387 cards,
select 1,518,677 calibration samples, and exclude 20,788 outliers. All three
prediction/comparison/confidence rounds complete, including a refresh during
Memorised replay. Prediction values remain synthetic; this verifies memory and
integration rather than live model accuracy.

| Measurement | Before (`890615d`) | After |
| --- | ---: | ---: |
| Peak renderer RSS | 3,877,248 KiB (3.70 GiB) | 3,416,304 KiB (3.26 GiB) |
| Whole sequence | 140.256 s | 129.008 s |
| Review aggregation | 30.993 s | 26.786 s |
| Memorised calculation | 60.266 s | 54.901 s |
| Selected calibration reviews | 1,518,677 | 1,518,677 |

Peak renderer RSS falls by 11.9%, saving 450 MiB, and whole-sequence time falls
by 8.0% in this before/after pair. The first updated run measured 3,455,888 KiB
(3.30 GiB) and 132.606 seconds; the final run above includes the completed
six-buffer ROC allocation check. These single-run figures vary with allocation,
GC and system load. They are additional gains over the previously measured
packed-history changes, not replacements for those earlier results. Full replay
still needs substantial memory; these measurements do not establish a maximum
supported collection size or guarantee that every live cache workload avoids OOM.

The same 250 ms renderer-RSS sampling method is used. The paged harness sends
actual selected review IDs, transfers the unread HTTP response body, and serves
pages through the real `prediction_response` helper. Python's selected rows are
retained during serialization and are outside the renderer RSS measurement.
Flask's unbuffered-client test separately verifies lazy 25,000-row serialization.
Worker queueing still prevents a refresh from starting another large calculation
while replay runs. No live collection is queried or modified.

Verification passes 419 tests and both frontend bundle/type checks. New cases
cover exact merged medians/means with uneven and sparse buckets, overlapping
filters, chunk boundaries, shared result-buffer transfer, row-count/completion
checks, UTF-8 boundaries, duplicate predictions spanning pages, cancellation,
legacy full-JSON compatibility, and ROC accumulator allocation. Existing frozen
calibration/bootstrap and independent Obuchowski covariance parity remain green.
An offscreen Svelte/Qt Time-category smoke renders all six graphs and exercises
mean/median, success and same-day filtering, bar width and scrolling.


## One history owner and bounded graph intermediates

The October 11 improvements were measured against commit `3dd8185`: incremental exact ROC integration, chunked daily S90 transitions, compact private replay time samples, and a single worker-owned history transferred to a fresh worker after each history calculation. The same retained-result Qt WebEngine 6.11.2 workload uses 79,387 cards and 3,785,024 review rows, three synthetic prediction/comparison/confidence rounds and refreshes during aggregation and Memorised replay.

| Measurement | Before (`3dd8185`) | After |
| --- | ---: | ---: |
| Peak renderer RSS | 3,610,352 KiB (3.44 GiB) | 2,499,168 KiB (2.38 GiB) |
| Whole sequence | 128.152 s | 120.911 s |
| Review aggregation | 27.122 s | 26.915 s |
| Memorised calculation | 55.059 s | 49.133 s |
| Selected calibration reviews | 1,518,677 | 1,518,677 |
| Outlier exclusions | 20,788 | 20,788 |

Peak RSS falls by 30.8%, saving about 1.06 GiB, and elapsed time falls by 5.7% in this single before/after pair. Renderer RSS uses the existing 250 ms sampling method and excludes the Python backend. The history buffer alone is about 231 MiB for this snapshot; it is now owned by one worker, rather than retained on the page alongside a per-task copy. The combined memory difference includes the other compact intermediates and garbage collection; it cannot be attributed to the buffer change alone. Synthetic predictions check allocation and integration, not live-cache coverage or model accuracy. An earlier development run measured 2,504,288 KiB and 118.186 seconds; the table uses the final packaged implementation. Single-run timing and RSS vary with system load and GC; full replay still needs substantial memory.

The main regression has only 50 distinct synthetic probabilities. A separate Qt worker stress case processes 1,518,677 distinct probabilities per model and 79,387 card clusters to exercise ROC threshold allocation. Peak renderer RSS falls from 523,760 to 302,336 KiB (42.3%, about 216 MiB). Both runs return 1,002 plotted points per model and identical SHA-256 hashes of their complete ROC outputs, including AUC, both confidence intervals and the paired difference. The test generates outcomes/probabilities in memory without collection access; its timings of 0.869 and 0.905 seconds do not establish a speed improvement.

Verification passes 436 tests in 60 suites and both frontend bundle/type checks. It includes exact equality of all 83 review/Memorised result fields on 3,443 reviews for 200 cards from the preserved copy, frozen full-threshold ROC point/AUC parity with ties and small endpoint steps, existing independent covariance/native FSRS checks, chunk boundaries and same-day daily-transition resets. Worker tests cover metadata-only loading, detached ownership transfers, calculator/fatal/transport errors, active and queued cancellation, and releasing the queue. Store tests reject obsolete search/range results. An actual Qt worker smoke loads paginated synthetic history, rotates it across repeated calculations, cancels active graphs and searches, replaces the search and confirms every owner is terminated. The Svelte/Qt Time smoke retains exact mean/median, success/same-day, merged-bar and scrolling behavior. No live collection is opened or modified.


## Native-width history and compact sample/replay/bootstrap collection

The next four improvements were compared with commit `089adca` in fresh runs of the same retained-result Qt WebEngine 6.11.2 workload. Both runs load 3,785,024 reviews for 79,387 cards, retain review and Memorised results and complete three prediction/comparison/confidence rounds, including refreshes during aggregation and Memorised replay. Predictions are synthetic at the real selected review IDs, checking allocation and integration rather than live-cache coverage or model accuracy.

| Measurement | Before (`089adca`) | After |
| --- | ---: | ---: |
| Peak renderer RSS | 2,497,472 KiB (2.38 GiB) | 2,315,456 KiB (2.21 GiB) |
| Whole sequence | 125.879 s | 116.114 s |
| Review aggregation | 27.572 s | 25.233 s |
| Memorised calculation | 49.225 s | 49.383 s |
| Review-history buffers | 242,241,536 bytes (231.0 MiB) | 128,690,816 bytes (122.7 MiB) |
| Selected calibration reviews | 1,518,677 | 1,518,677 |
| Outlier exclusions | 20,788 | 20,788 |

Peak renderer RSS falls by 7.3%, saving about 178 MiB, and whole-sequence time falls by 7.8% in this pair. The history columns use 34 bytes per review instead of 64, a 46.875% reduction saving 108.3 MiB for this snapshot. The overall peak includes sample construction, replay grouping, bootstrap collection and GC, so it cannot be attributed to history alone. Memorised calculation time is effectively unchanged. RSS is sampled every 250 ms with the same renderer PID method and excludes the Python backend. These are single before/after runs; timings and peaks vary with GC and system load, and full replay still requires substantial memory.

Verification passes 448 tests in 61 suites and both frontend bundle/type checks. Independent old/new calculators return exactly equal values for all 83 review/Memorised result fields and calibration selection on the preserved 200-card, 3,443-review subset. Tests cover native signed/unsigned boundaries, invalid truncation/wrapping, exact ID precision, eight detached ownership buffers, legacy inputs, ordered/shuffled/duplicate replay, resets/cutoffs, sample chunk boundaries and deterministic bootstrap parity across card chunks. Actual Qt checks exercise history rotation and graph/search cancellation, all six Time graphs and their controls, and the separate comparison/Memorised Calculate actions. The full preserved-history sequence completes with unchanged selected/outlier counts. No live collection is opened or modified.
