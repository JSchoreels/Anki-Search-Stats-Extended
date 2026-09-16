import type { CalibrationSample } from "./MemorisedBar"

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

    return { points, auc }
}

/**
 * Builds both ROC curves from the same eligible reviews so FSRS and RWKV are
 * compared on an identical positive/negative sample.
 */
export function buildRocData(
    samples: CalibrationSample[],
    fsrsPredictions: Record<number, number>,
    rwkvPredictions: Record<number, number>
): RocData {
    const fsrsOutcomes: ScoredOutcome[] = []
    const rwkvOutcomes: ScoredOutcome[] = []
    let positiveCount = 0
    let negativeCount = 0

    for (const sample of samples) {
        const fsrs = fsrsPredictions[sample.revlogId]
        const rwkv = rwkvPredictions[sample.revlogId]
        if (
            !isProbability(fsrs) ||
            !isProbability(rwkv) ||
            (sample.actual !== 0 && sample.actual !== 1)
        ) {
            continue
        }

        const actual = sample.actual as 0 | 1
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
