import { type CalibrationSamples, heldOutFsrsPredictions, sampleCount } from "./calibrationSamples"
import { type AucInterval, buildRocData, type RocSeries } from "./rocData"
import { buildUmPlusData, visibleUmPlusBins } from "./umPlusData"

type PredictionSource = {
    column: string | null
    predictions: Float64Array
    roles?: string[]
    roleCounts?: Record<string, number>
}

type FsrsDiagnosticSource = PredictionSource & {
    cachedPredictionCount: number
    roles: string[]
}

const interval = ({ lower, upper }: AucInterval, format: (value: number) => string) =>
    `95% CI ${format(lower)} to ${format(upper)}`
const fixed = (value: number) => value.toFixed(4)
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(4)}`
const aucSummary = ({ auc, interval: ci }: RocSeries) =>
    auc === undefined
        ? "unavailable"
        : `${fixed(auc)}${ci ? ` (${interval(ci, fixed)})` : " (CI unavailable)"}`

function predictionSummary(samples: CalibrationSamples, predictions: Float64Array) {
    let count = 0
    let first = Infinity
    let last = -Infinity
    for (let i = 0; i < sampleCount(samples); i++) {
        const value = predictions[i]
        if (!Number.isFinite(value) || value < 0 || value > 1) continue
        count++
        first = Math.min(first, samples.revlogIds[i])
        last = Math.max(last, samples.revlogIds[i])
    }
    const range = count
        ? `${new Date(first).toISOString()} to ${new Date(last).toISOString()}`
        : "none"
    return { count, range }
}

// Report only aggregates from the current graph inputs; no new backend requests.
export function calibrationDiagnosticReport(
    samples: CalibrationSamples,
    replayPredictions: Float64Array,
    fsrs: FsrsDiagnosticSource,
    rwkv: PredictionSource,
    dayRange: number
): string {
    const replay = predictionSummary(samples, replayPredictions)
    const selected = predictionSummary(samples, fsrs.predictions)
    const rwkvSelected = predictionSummary(samples, rwkv.predictions)
    const heldOutFsrs = heldOutFsrsPredictions(fsrs)
    const paired = buildUmPlusData(samples, heldOutFsrs, rwkv.predictions)
    const roc = buildRocData(samples, heldOutFsrs, rwkv.predictions)
    const usesCache = fsrs.cachedPredictionCount > 0
    return [
        "SSE troubleshooting report build 2026-10-07.1",
        `Review range: ${dayRange === 0 ? "all history" : `${dayRange} days`}; current stats search`,
        `Eligible historical calibration samples: ${sampleCount(samples)}`,
        `FSRS historical replay predictions: ${replay.count}`,
        `FSRS cached predictions returned: ${fsrs.cachedPredictionCount}`,
        `FSRS cache roles returned: ${fsrs.roles.join(", ") || "none / not reported"}`,
        `FSRS cache source: ${fsrs.column ?? "none"}`,
        `FSRS graph uses: ${usesCache ? "cached predictions only" : "historical replay fallback"}`,
        `FSRS reviews used: ${selected.count}; eligible without selected FSRS prediction: ${sampleCount(samples) - selected.count}`,
        `FSRS selected review dates (UTC): ${selected.range}`,
        `RWKV source: ${rwkv.column ?? "none"}; reviews used: ${rwkvSelected.count}`,
        `RWKV cache roles returned: ${rwkv.roles?.join(", ") || "none / not reported"}`,
        `RWKV cached post-optimization reviews: ${rwkv.roleCounts?.post_optimization ?? 0}; post-optimization replay reviews: ${rwkv.roleCounts?.post_optimization_replay ?? 0}`,
        `RWKV selected review dates (UTC): ${rwkvSelected.range}`,
        `Paired FSRS + RWKV reviews: ${paired.count}${usesCache ? "" : " (replay predictions are not compared with RWKV)"}`,
        `ROC AUC (card-clustered DeLong): FSRS ${aucSummary(roc.fsrs)}; RWKV ${aucSummary(roc.rwkv)}`,
        `AUC difference (FSRS − RWKV): ${roc.difference ? `${signed(roc.difference.value)} (${interval(roc.difference.interval, signed)})` : "unavailable"}`,
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
