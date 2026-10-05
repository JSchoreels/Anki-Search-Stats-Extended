import type { CalibrationSample } from "./MemorisedBar"
import { buildUmPlusData, visibleUmPlusBins } from "./umPlusData"

type PredictionSource = {
    column: string | null
    predictionsByRevlogId: Record<number, number>
    roles?: string[]
    roleCounts?: Record<string, number>
}

type FsrsDiagnosticSource = PredictionSource & {
    cachedPredictionCount: number
    roles: string[]
}

function predictionSummary(samples: CalibrationSample[], predictions: Record<number, number>) {
    let count = 0
    let first = Infinity
    let last = -Infinity
    for (const sample of samples) {
        const value = predictions[sample.revlogId]
        if (!Number.isFinite(value) || value < 0 || value > 1) continue
        count++
        first = Math.min(first, sample.revlogId)
        last = Math.max(last, sample.revlogId)
    }
    const range = count
        ? `${new Date(first).toISOString()} to ${new Date(last).toISOString()}`
        : "none"
    return { count, range }
}

// Report only aggregates from the current graph inputs; no new backend requests.
export function calibrationDiagnosticReport(
    samples: CalibrationSample[],
    replayPredictions: Record<number, number>,
    fsrs: FsrsDiagnosticSource,
    rwkv: PredictionSource,
    dayRange: number
): string {
    const replay = predictionSummary(samples, replayPredictions)
    const selected = predictionSummary(samples, fsrs.predictionsByRevlogId)
    const rwkvSelected = predictionSummary(samples, rwkv.predictionsByRevlogId)
    const paired = buildUmPlusData(samples, fsrs.predictionsByRevlogId, rwkv.predictionsByRevlogId)
    const usesCache = fsrs.cachedPredictionCount > 0
    return [
        "SSE troubleshooting report build 2026-10-05.5",
        `Review range: ${dayRange === 0 ? "all history" : `${dayRange} days`}; current stats search`,
        `Eligible historical calibration samples: ${samples.length}`,
        `FSRS historical replay predictions: ${replay.count}`,
        `FSRS cached predictions returned: ${fsrs.cachedPredictionCount}`,
        `FSRS cache roles returned: ${fsrs.roles.join(", ") || "none / not reported"}`,
        `FSRS cache source: ${fsrs.column ?? "none"}`,
        `FSRS graph uses: ${usesCache ? "cached predictions only" : "historical replay fallback"}`,
        `FSRS reviews used: ${selected.count}; eligible without selected FSRS prediction: ${samples.length - selected.count}`,
        `FSRS selected review dates (UTC): ${selected.range}`,
        `RWKV source: ${rwkv.column ?? "none"}; reviews used: ${rwkvSelected.count}`,
        `RWKV cache roles returned: ${rwkv.roles?.join(", ") || "none / not reported"}`,
        `RWKV cached post-optimization reviews: ${rwkv.roleCounts?.post_optimization ?? 0}; post-optimization replay reviews: ${rwkv.roleCounts?.post_optimization_replay ?? 0}`,
        `RWKV selected review dates (UTC): ${rwkvSelected.range}`,
        `Paired FSRS + RWKV reviews: ${paired.count}`,
        `UM+ populated buckets: ${paired.bins.length}; buckets visible with default >=200 filter: ${visibleUmPlusBins(paired.bins, false).length}`,
        ...((rwkv.roleCounts?.post_optimization_replay ?? 0) > 0
            ? [
                  "Recent RWKV replay covers the active FSRS post-optimization cohort; these are not historical validation folds.",
              ]
            : []),
        ...(usesCache && selected.count < replay.count
            ? [
                  "Cache selection reduces the FSRS sample. Historical replay is not merged into a non-empty cache.",
              ]
            : []),
        ...(fsrs.roles.length === 1 && fsrs.roles[0] === "post_optimization"
            ? [
                  "Only post_optimization cache roles were returned; no historical validation_fold predictions were returned for this search.",
              ]
            : []),
        ...(paired.count > 0 && visibleUmPlusBins(paired.bins, false).length === 0
            ? [
                  "UM+ pairs exist, but all buckets are hidden. Enable Show Small Buckets to see them.",
              ]
            : []),
        "Calibration summary contains aggregate counts and dates, without card content or review IDs.",
    ].join("\n")
}
