# RWKV workload forecast graph: handoff

Branch `rwkv-workload-forecast` (off main 115bb21).

## Done (written, NOT yet built or run)
- `workload_forecast.py`: bridge to `aqt.rwkv_scheduler` (availability check, start/progress/cancel of the background job; days clamped 1..365, paths 1..2000).
- `__init__.py`: POST handlers `workloadForecastAvailable`, `startWorkloadForecast`, `workloadForecastProgress`, `cancelWorkloadForecast`. `Makefile` and `package.sh` list the new module.
- `src/ts/workloadForecastData.ts`: types and data shaping (`buildForecastPoints`, totals, progress).
- `src/ts/WorkloadForecastGraph.ts`: d3 fan chart (mean line, dashed median, p5-p95 band, lighter p1-p99 band, hover tooltip).
- `src/ts/WorkloadForecast.svelte`: card in the FSRS category (after Current Disagreement). Controls: days, number of futures (default 50), Run/Cancel, metric (due / done / new / lapses / minutes), progress line, caption. Shows a "needs a newer Anki fork build" note when the capability check is false.
- `locale/en_GB.ftl`: strings. `test/workloadForecast.test.ts`: jest tests for the shaping and tooltip.

## Not done
- No Node/npm on the machine where this was written: `npm i`, `npm test`, `npm run format`, `npm run build` (or `make stats.min.js`) were never run. Run them first and fix any type or test errors.
- Not tested against a real fork build.
- Possible follow-ups: `fast=True` option in the UI, per-deck lines (`groups` in the result), other locale files, a Python test of `workload_forecast.py` with a fake scheduler.

## Testing against the fork
Needs an Anki build of the fork branch `rwkv-workload-forecast` (commits c022b938d, 7a6a2d882, 89b3c27a7) with the RWKV backend running. Build 110 does not have it, so the card shows the note there. Contract: `docs/rwkv.MD`, "Workload Forecast". Package with `make` / `package.sh`, install into a test profile only (never the main one), open Stats, find "RWKV workload forecast" in the FSRS section, run 20 paths x 30 days (about a minute on a 30k-card collection).
