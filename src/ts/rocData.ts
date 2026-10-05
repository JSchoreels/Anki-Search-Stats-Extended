import { type CalibrationSamples, sampleCount } from "./calibrationSamples"

export const ROC_POINT_RESOLUTION = 1 / 1000

export type RocPoint = {
    falsePositiveRate: number
    truePositiveRate: number
    threshold: number
}

export type RocSeries = {
    points: RocPoint[]
    auc: number | undefined
}

export type RocData = {
    fsrs: RocSeries
    rwkv: RocSeries
    count: number
    positiveCount: number
    negativeCount: number
}

type ScoredOutcome = {
    score: number
    actual: 0 | 1
}

function isProbability(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

function buildRocSeries(
    outcomes: ScoredOutcome[],
    positiveCount: number,
    negativeCount: number
): RocSeries {
    if (positiveCount === 0 || negativeCount === 0) {
        return { points: [], auc: undefined }
    }

    const sorted = [...outcomes].sort((left, right) => right.score - left.score)
    const points: RocPoint[] = [
        { falsePositiveRate: 0, truePositiveRate: 0, threshold: Number.POSITIVE_INFINITY },
    ]
    let truePositives = 0
    let falsePositives = 0

    for (let start = 0; start < sorted.length; ) {
        const threshold = sorted[start].score
        let end = start
        while (end < sorted.length && sorted[end].score === threshold) {
            if (sorted[end].actual === 1) {
                truePositives += 1
            } else {
                falsePositives += 1
            }
            end += 1
        }
        points.push({
            falsePositiveRate: falsePositives / negativeCount,
            truePositiveRate: truePositives / positiveCount,
            threshold,
        })
        start = end
    }

    const auc = points.slice(1).reduce((area, point, index) => {
        const previous = points[index]
        const width = point.falsePositiveRate - previous.falsePositiveRate
        return area + (width * (point.truePositiveRate + previous.truePositiveRate)) / 2
    }, 0)

    const sampledPoints = [points[0]]
    for (let index = 1; index < points.length - 1; index++) {
        const point = points[index]
        const previous = sampledPoints[sampledPoints.length - 1]
        if (
            point.falsePositiveRate - previous.falsePositiveRate >= ROC_POINT_RESOLUTION ||
            point.truePositiveRate - previous.truePositiveRate >= ROC_POINT_RESOLUTION
        ) {
            sampledPoints.push(point)
        }
    }
    sampledPoints.push(points[points.length - 1])

    return { points: sampledPoints, auc }
}

/**
 * Builds both ROC curves from the same eligible reviews so FSRS and RWKV are
 * compared on an identical positive/negative sample.
 */
export function buildRocData(
    samples: CalibrationSamples,
    fsrsPredictions: Float64Array,
    rwkvPredictions: Float64Array
): RocData {
    const fsrsOutcomes: ScoredOutcome[] = []
    const rwkvOutcomes: ScoredOutcome[] = []
    let positiveCount = 0
    let negativeCount = 0

    for (let i = 0; i < sampleCount(samples); i++) {
        const fsrs = fsrsPredictions[i]
        const rwkv = rwkvPredictions[i]
        if (
            !isProbability(fsrs) ||
            !isProbability(rwkv) ||
            (samples.actual[i] !== 0 && samples.actual[i] !== 1)
        ) {
            continue
        }

        const actual = samples.actual[i] as 0 | 1
        fsrsOutcomes.push({ score: fsrs, actual })
        rwkvOutcomes.push({ score: rwkv, actual })
        if (actual === 1) {
            positiveCount += 1
        } else {
            negativeCount += 1
        }
    }

    return {
        fsrs: buildRocSeries(fsrsOutcomes, positiveCount, negativeCount),
        rwkv: buildRocSeries(rwkvOutcomes, positiveCount, negativeCount),
        count: fsrsOutcomes.length,
        positiveCount,
        negativeCount,
    }
}
