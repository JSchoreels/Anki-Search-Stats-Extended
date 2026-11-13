import { calculateActiveRetrievabilityHistory } from "./activeRetrievabilityMatrix"
import {
    parseReviewRetrievabilityPages,
    parseReviewRetrievabilityResponse,
} from "./calibrationPredictions"
import type { CalibrationSamples } from "./calibrationSamples"
import { selectCalibrationSamples } from "./calibrationSampleSelection"
import {
    buildDailyPredictionData,
    dailyPredictionReviewWindow,
    type DailyPredictionDisplayMetric,
} from "./dailyPredictionData"
import { dailyActualRecall, dailyRecallModelReviewWindows } from "./dailyRecallGap"
import { calculateMaturationHistory } from "./maturation"
import {
    buildCalibrationBinCounts,
    buildCalibrationBins,
    calibrationConfidenceIntervals,
    getMemorisedDays,
} from "./MemorisedBar"
import { calculateFsrsReviewWindow } from "./reviewRecall"
import { calculateRevlogStats } from "./revlogGraphs"
import { buildRocData } from "./rocData"
import { buildUmPlusData } from "./umPlusData"

async function calibrationPredictions(
    samples: CalibrationSamples,
    response: string | ReadableStream<Uint8Array>
) {
    const parsed =
        typeof response === "string"
            ? parseReviewRetrievabilityResponse(response, samples)
            : await parseReviewRetrievabilityPages(response, samples)
    return { ...parsed, bins: buildCalibrationBinCounts(samples, parsed.predictions) }
}

function comparison(samples: CalibrationSamples, fsrs: Float64Array, rwkv: Float64Array) {
    return {
        umPlus: buildUmPlusData(samples, fsrs, rwkv),
        roc: buildRocData(samples, fsrs, rwkv),
        fsrsDaily: buildDailyPredictionData(samples, fsrs),
        rwkvDaily: buildDailyPredictionData(samples, rwkv),
    }
}

function dailyPredictionReviewWindows(
    samples: CalibrationSamples,
    fsrs: Float64Array,
    rwkv: Float64Array,
    metric: DailyPredictionDisplayMetric,
    reviews: number
) {
    return {
        fsrs: dailyPredictionReviewWindow(samples, fsrs, metric, reviews),
        rwkv: dailyPredictionReviewWindow(samples, rwkv, metric, reviews),
    }
}

const tasks = {
    revlog: calculateRevlogStats,
    maturation: calculateMaturationHistory,
    activeRetrievability: calculateActiveRetrievabilityHistory,
    memorised: getMemorisedDays,
    calibrationSamples: selectCalibrationSamples,
    calibrationBands: calibrationConfidenceIntervals,
    calibrationPredictions,
    calibrationReplay: buildCalibrationBins,
    comparison,
    umPlus: buildUmPlusData,
    roc: buildRocData,
    dailyPredictionData: buildDailyPredictionData,
    dailyPredictionReviewWindows,
    dailyActualRecall,
    dailyRecallModelReviewWindows,
    fsrsReviewWindow: calculateFsrsReviewWindow,
}

export type Tasks = typeof tasks

const dispatch: {
    [K in keyof Tasks]: (...args: Parameters<Tasks[K]>) => ReturnType<Tasks[K]>
} = tasks

export function runStatsTaskLocally<K extends keyof Tasks>(
    task: K,
    args: Parameters<Tasks[K]>
): ReturnType<Tasks[K]> {
    const calculate = dispatch[task]
    if (!calculate) throw new Error(`Unknown stats calculation: ${task}`)
    return calculate(...args)
}
