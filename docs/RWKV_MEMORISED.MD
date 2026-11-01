# RWKV Memorised History

## User-visible behavior

The Memorised graph has an FSRS, RWKV, and Both source selector. FSRS remains
the default. Once Memorised has been requested with Calculate (or automatic
Memorised loading is enabled), selecting RWKV starts a background historical
replay when the local cache is missing or stale. Enabling calibration/UM+/ROC
alone does not request RWKV Memorised history. The progress bar counts card-day predictions,
and the RWKV line extends from the oldest completed scheduler day toward today
while the calculation runs. In Both mode, the complete FSRS line remains
visible while RWKV catches up.

Cards, Notes, Cards by Burden, and Average Retrievability support RWKV.
Retrievability & Stability and the B-W matrix remain FSRS-only because RWKV
does not expose equivalent stability and difficulty state.

Memorised's Total and Trend views support [drag-to-zoom](TIME_AXIS_ZOOM.MD).
Zoom changes only the displayed dates, preserves cumulative totals and drawn
trends, and has a local **Reset zoom** control. FSRS and RWKV share the selected
date range when both are displayed.

A trailing moving average starts enabled with an editable **7-day** window and
applies to Cards, Notes, Cards by Burden, Average Retrievability, and the
FSRS-only Retrievability & Stability view. Colored lines show the average while
faint grey lines retain the daily estimates; the RWKV daily line is dashed when
both models are available. Disable **Moving average** to restore the original
colored daily lines. Each available calendar day has equal weight, the initial
partial window uses the available history, and a one-day window equals the raw
series. Averaging uses the complete series before zoom crops the displayed date
range. The controls are local to the current Statistics view and do not alter
the estimates, caches, or replay requests.

The separate **Review Recall and Gain** graph compares each model's
predicted recall for the answered cards with and without each actual answer.
Choose **Immediately**, **10 minutes**, **1 hour**, or **24 hours** after the
answer. Both branches are queried at that same future time, with no intervening
answers in either branch. The result is a model projection, not an observed or
causal effect. A recall view plots the answer-weighted average probability for
each branch (solid for with the review, dashed for without); the gain view plots
their difference scaled to 100 modeled answers. Forgetting on other cards does
not contribute. FSRS, RWKV, and Both are selected independently from the main
Memorised graph.

Its compact moving-average control defaults to a seven-calendar-day window and
also offers the last N study days with modeled answers or the last N modeled
reviews (initially 1,000). Calendar and study-day windows combine the daily
answer totals; review windows use individual answers, including a partial day
when needed. Each model uses its own eligible answers and may therefore cover a
different time span. The initial partial window uses the available answers.

The gain line is a rolling ratio:

`100 × sum(per-answer recall changes) / count(modeled answers)`

This is intentionally not an average of daily ratios. Days without modeled
answers do not add collection-wide memory decay to later windows. **Connect
missing days** starts enabled and draws faint interpolated connectors between
available averaged values; it can be disabled. The connectors preserve distinct
patterns for the solid with-review and dashed without-review lines. They do not
invent answers or daily values. The faint grey line retains the raw daily ratio
in gain view. FSRS sets
recall to essentially 100% immediately after an answer, including Again;
same-day FSRS-6 repeats therefore normally have zero immediate gain. The
projection uses the existing FSRS model's elapsed-time convention: FSRS-7 uses
fractional days, while FSRS-6 counts scheduler-day boundaries. RWKV-Instant
recall can rise or fall after the answer; no monotonicity is imposed. A negative
gain can reflect how an answer updates the model and does not establish that
answering harmed memory. First learning answers use zero recall in the skipped
branch. A first retained answer with incomplete history, an unavailable elapsed
time for a future RWKV query, and invalid predictions are excluded from both
branches and the denominator. The models can therefore have different coverage.

FSRS reuses its existing historical replay. RWKV runs a separate cancellable
chronological replay, querying an isolated pre-answer or post-answer model state
at the chosen future elapsed time. Query inputs also advance the scheduler day
on rollover, without advancing recurrent state. When the Anki runtime supports
batched post-answer predictions for the immediate horizon or custom batched
future queries for later horizons, it uses two bounded passes and holds only one
recurrent model state at a time; older builds use a slower per-answer replay.
When the slower replay is used, the graph
warns that a newer compatible Anki version may calculate it faster. Both paths
advance the recurrent state using all retained history and score only the
selected cards and date range.
The replay waits while the main RWKV Memorised history or another heavy RWKV
replay is active. Completed results are retained in memory for the same selection
history and horizon during the Anki session; they are not saved to a collection or cache
database. This replay can be lengthy for a large history. While averaging is
enabled, the vertical scale follows the colored rolling ratios so an extreme raw
day with few answers cannot flatten the useful lines. Grey daily values remain
available in tooltips; disabling
averaging restores their full-range scale.

An FSRS review-count window runs a dedicated in-memory replay of the loaded
history when the window size or horizon changes; this can take time and uses
the shared statistics worker queue. Other window types reuse the daily totals.
For RWKV, the completed replay retains two 64-bit values per eligible answer
in memory, allowing an exact review window without replaying the model. The
`rwkvReviewGainWindow` endpoint returns only the resulting daily rolling values,
not the per-answer arrays. Review-count results appear after the RWKV replay
finishes; calendar and study-day results continue to appear progressively. A
cancelled or failed replay discards its per-answer arrays, and a completed job
retains them until replaced or Anki exits.

## Computation boundary

The add-on starts and polls the adapted Anki build through these add-on media
server endpoints:

- `/_anki/startRwkvMemorisedHistory`
- `/_anki/rwkvMemorisedHistoryProgress`
- `/_anki/cancelRwkvMemorisedHistory`

Anki creates an isolated embedded RWKV runtime. It does not mutate or snapshot
the active reviewer runtime. Existing-card review history is replayed in
scheduler-day order. After all answers on a day have advanced recurrent state,
Anki batch-queries every card introduced by that day. This matches the
Memorised graph's daily, post-review-state interpretation.

Progress uses the total number of card-day predictions, rather than elapsed
days, because later days generally contain more active cards and take longer.
Partial results retain full-precision sums for the selected search while the
per-card cache is being built. A compact resumable checkpoint is exposed about
every 30 seconds and immediately when cancellation is requested.

## Persistent cache

The completed cache and resumable checkpoints are written atomically to the profile-local
`retrievability_cache` sidecar when that database is attached, with the same
main-database fallback used by the calibration caches on older Anki builds.
It is not included in collection sync or full upload.

The tables are:

1. `search_stats_rwkv_memorised_meta`
2. `search_stats_rwkv_memorised_card`
3. `search_stats_rwkv_memorised_checkpoint_meta`
4. `search_stats_rwkv_memorised_checkpoint_card`

Each card row stores its first scheduler day and a packed little-endian UInt16
array encoded as Base64 for Anki's JSON-backed database bridge. Values map
probabilities from `[0, 1]` to `[0, 65535]`. This keeps the maximum quantization
error below one hundred-thousandth. The raw representation requires two bytes
per card-day; Base64 adds roughly one third, so a 5.05-million-card-day
collection uses about 14 MB plus SQLite row overhead.

The checkpoint tables are separate from the completed-cache tables. Replacing
a checkpoint cannot damage the last complete cache, and completing a build
atomically installs the final cache and removes the checkpoint. On resume,
Anki validates the exact history/model/config identity, restores the partial
series, quickly replays historical answers through the checkpoint day to
reconstruct recurrent state, and continues with the first uncomputed day. It
does not persist the full recurrent snapshot: that snapshot measured about
1.19 GB on the benchmark profile, while answer-only replay avoids recomputing
the millions of already checkpointed card-day predictions.

The cache identity includes the collection, RWKV model, historical answer
count/checkpoint, scheduler day, dynamic-preset replay settings, optional
feature-state settings, first-review elapsed behavior, and self-correction
configuration. When only append-only review history or the scheduler day has
advanced, the add-on passes the last completed cache back to Anki. Anki validates
that the cached review prefix is unchanged, keeps predictions through the day
before the first new answer, reconstructs recurrent state without repeating
those card-day predictions, and recomputes from the affected day. A producer
configuration change or a non-append history change starts a full background
build. Cancelled builds save the most recent completed day; failed builds retain
the latest periodic checkpoint. Neither replaces the last completed cache.

## Source locations

- Anki computation and progress job:
  `/Users/jschoreels/workspace/anki/qt/aqt/rwkv_scheduler.py`
- Snapshot-free embedded replay calls:
  `/Users/jschoreels/workspace/anki/qt/aqt/rwkv_srs_benchmark.py`
- Add-on cache and HTTP endpoints: `__init__.py`
- Polling stores and graph state: `src/ts/stores.ts`
- Shared source selector and progress UI: `src/ts/MemorisedSourceControls.svelte`
- Review-gain graph and rolling-ratio calculation:
  `src/ts/MemorisedPerReview.svelte` and `src/ts/memorisedPerReview.ts`
- RWKV per-answer replay and progress: `rwkv_review_gain.py`
- Shared trailing-average helper: `src/ts/dailyMovingAverage.ts`
