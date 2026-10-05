# Statistics loading

The stats page fetches card data once for each search. Interval histograms use
those cards (review and relearning types), excluding queue -1 when suspended
cards are hidden. Toggling suspended cards does not issue another graphs request.

Review-history aggregation, FSRS Memorised history, and calibration bootstrap
calculations run in a dedicated worker. The calculation formulas are shared with
the existing tests. Changing the search or history range terminates obsolete
workers and ignores obsolete endpoint responses. Worker failures are reported;
they do not fall back to blocking the page.

Historical FSRS calibration generation starts only from the **Generate FSRS
calibration data** button. Ordinary Statistics loads read caches immediately;
they perform no generation freshness scan or polling delay. FSRS and RWKV cache
reads are independent, so RWKV is available while FSRS training is pending.
The explicit job runs as a serialized Anki background operation with native
cancellable progress. Ordinary presets resolve once per home deck and use short
native preset searches. Overlay routing retains exact per-card settings, with
one native batch resolver preparation and cached home-deck options. Explicit
repeat generation checks historical-prefix hashes and cache coverage to reuse
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
