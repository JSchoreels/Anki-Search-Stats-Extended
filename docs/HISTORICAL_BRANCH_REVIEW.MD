# Historical branch integration

The statistics add-on kept several older feature branches after their work was
squash-merged or revised. This review compares them with the refreshed fork and
upstream refs and preserves the current graph, replay, and configuration code.

| Branch | Resolution |
| --- | --- |
| `feature/card-stability-over-time` | Included in upstream [#32](https://github.com/Luc-Mcgrady/Anki-Search-Stats-Extended/pull/32); the current Stability Over Time graph uses replayed S90 and exact means and medians. |
| `feature/memorized-with-stability`, `feature/memorized-with-stability-upstream` | Superseded by upstream [#41](https://github.com/Luc-Mcgrady/Anki-Search-Stats-Extended/pull/41) and the current bounded stability-weighted Memorised view. |
| `feature/database_hardnessing`, `feature/load_by_introduced` | The first is an ancestor of the second, whose work was incorporated by upstream [#81](https://github.com/Luc-Mcgrady/Anki-Search-Stats-Extended/pull/81). |
| `fixes/database-values-handling-hardening` | Incorporated by upstream [#82](https://github.com/Luc-Mcgrady/Anki-Search-Stats-Extended/pull/82). |
| `feature/long-term-forgetting-curve-decay` | Incorporated by upstream [#95](https://github.com/Luc-Mcgrady/Anki-Search-Stats-Extended/pull/95). |
| `origin/feature/configure.default.graph_mode` | Incorporated by upstream [#45](https://github.com/Luc-Mcgrady/Anki-Search-Stats-Extended/pull/45). |
| `codex/retrievability-ordered-shifts` | Reimplemented in `8a33c41`, `978a8d4`, `851c1ca`, and `3c42531`, including the later graph-correctness work. |
| `feature/reviews_by_introduced` | Finished the lapse-rate distribution as current lapses per 100 days since the latest introduction or reintroduction, with explicit missing-history and same-day handling. |
| `feature/lapse-average-burden` | Added card-weighted average-load graphs. Existing load-by-metric graphs already provide the branch's ratio, cumulative, and percentile views with correct grouping. |
| `origin/feature/average_repetition_by_lapse` | Added average repetitions by lapse count and the original optional repetitions / (lapses + 1) view, weighted by cards within each displayed range. The branch's outdated unrelated file replacements are not restored. |
| `origin/feature/difficulty.with.time` | Added daily mean and median replayed FSRS difficulty, retaining the current preset and reset behavior. |
| `feature/user-defined-trends` | Retain active Memorised trends across mode changes without deleting or migrating existing mode-specific pinned ranges. |

The old prototypes also contained debug logging, incorrect grouped averages,
and stale translations and dependencies. Those are intentionally not restored.
The individual branch refs remain available for their complete history.
