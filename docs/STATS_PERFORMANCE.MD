# Statistics loading

The stats page fetches card data once for each search. Interval histograms use
those cards (review and relearning types), excluding queue -1 when suspended
cards are hidden. Toggling suspended cards does not issue another graphs request.

Review-history aggregation, FSRS Memorised history, and calibration bootstrap
calculations run in a dedicated worker. The calculation formulas are shared with
the existing tests. Changing the search or history range terminates obsolete
workers and ignores obsolete endpoint responses. Worker failures are reported;
they do not fall back to blocking the page.

Anki's pending-RWKV graph retries reuse SSE's current search data until RWKV is
ready; RWKV calibration then reloads any newly available predictions. This reuse is limited to a pending response with the same search, native
history range, and SSE all-time setting in the same page. An ordinary refresh
loads fresh data. Searches using RWKV properties always reload because their
matching cards may change when scores become available.

FSRS preset loading first prepares the native batch resolver using
`card_memory_metrics(..., include_retrievability=True)`, then reads resolved
presets per card. This avoids repeated cold search preparation. The endpoint
returns `{presets: [...], cards: {cardId: presetIndex}}`, deduplicating complete
settings rather than preset ids so deck/card overrides remain intact.

Each stats window owns one page-load callback. Refresh replaces that callback
and continues to read rebuilt JavaScript/CSS from disk. `npm run build` produces
both `stats.min.js` and `stats-worker.js`; packaging and installation must include
both. The worker is served by Anki's add-on media endpoint on the same origin.
After installing Python changes, fully quit and reopen Anki.
