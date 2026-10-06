import { type CalibrationSamples, sampleCount } from "./calibrationSamples"

export const ROC_POINT_RESOLUTION = 1 / 1000

export type RocPoint = {
    falsePositiveRate: number
    truePositiveRate: number
    threshold: number
}

export type AucInterval = { lower: number; upper: number }

export type AucDifference = { value: number; interval: AucInterval }

export type RocSeries = {
    points: RocPoint[]
    auc: number | undefined
    interval: AucInterval | undefined
}

export type RocData = {
    difference: AucDifference | undefined
    fsrs: RocSeries
    rwkv: RocSeries
    count: number
    positiveCount: number
    negativeCount: number
}

function isProbability(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

function buildRocSeries(
    scores: Float64Array,
    actual: Uint8Array,
    placements: Float64Array,
    positiveCount: number,
    negativeCount: number
): RocSeries {
    if (positiveCount === 0 || negativeCount === 0) {
        return { points: [], auc: undefined, interval: undefined }
    }

    const sorted = Uint32Array.from(scores, (_, index) => index)
    sorted.sort((left, right) => scores[right] - scores[left])
    const points: RocPoint[] = [
        { falsePositiveRate: 0, truePositiveRate: 0, threshold: Number.POSITIVE_INFINITY },
    ]
    let truePositives = 0
    let falsePositives = 0

    for (let start = 0; start < sorted.length; ) {
        const threshold = scores[sorted[start]]
        const previousTP = truePositives
        const previousFP = falsePositives
        let end = start
        while (end < sorted.length && scores[sorted[end]] === threshold) {
            if (actual[sorted[end]] === 1) {
                truePositives += 1
            } else {
                falsePositives += 1
            }
            end += 1
        }
        const p = truePositives - previousTP
        const q = falsePositives - previousFP
        for (let index = start; index < end; index++) {
            const review = sorted[index]
            placements[review] =
                actual[review] === 1
                    ? (negativeCount - falsePositives + 0.5 * q) / negativeCount
                    : (truePositives - 0.5 * p) / positiveCount
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

    return { points: sampledPoints, auc, interval: undefined }
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
    const capacity = sampleCount(samples)
    const fsrsScores = new Float64Array(capacity)
    const rwkvScores = new Float64Array(capacity)
    const actuals = new Uint8Array(capacity)
    const cardIds = new Float64Array(capacity)
    let count = 0
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
        fsrsScores[count] = fsrs
        rwkvScores[count] = rwkv
        actuals[count] = actual
        cardIds[count] = samples.cardIds[i]
        count++
        if (actual === 1) {
            positiveCount += 1
        } else {
            negativeCount += 1
        }
    }

    const fsrsPlacements = new Float64Array(count)
    const rwkvPlacements = new Float64Array(count)
    const fsrs = buildRocSeries(
        fsrsScores.subarray(0, count),
        actuals,
        fsrsPlacements,
        positiveCount,
        negativeCount
    )
    const rwkv = buildRocSeries(
        rwkvScores.subarray(0, count),
        actuals,
        rwkvPlacements,
        positiveCount,
        negativeCount
    )
    const difference = clusteredIntervals(
        fsrs,
        rwkv,
        actuals,
        cardIds,
        fsrsPlacements,
        rwkvPlacements,
        positiveCount,
        negativeCount
    )

    return { fsrs, rwkv, difference, count, positiveCount, negativeCount }
}

function aucInterval(value: number, variance: number, minimum: number): AucInterval {
    const margin = 1.959963984540054 * Math.sqrt(Math.max(0, variance))
    return { lower: Math.max(minimum, value - margin), upper: Math.min(1, value + margin) }
}

function clusteredIntervals(
    fsrs: RocSeries,
    rwkv: RocSeries,
    actual: Uint8Array,
    cardIds: Float64Array,
    fsrsPlacements: Float64Array,
    rwkvPlacements: Float64Array,
    M: number,
    N: number
): AucDifference | undefined {
    if (fsrs.auc === undefined || rwkv.auc === undefined) return undefined

    // Card-clustered DeLong (Obuchowski 1997): reviews of one card are correlated,
    // matching the card-level bootstrap used for calibration bands.
    const clusters = new Map<number, number>()
    const m = new Float64Array(fsrsPlacements.length)
    const n = new Float64Array(fsrsPlacements.length)
    const x = [new Float64Array(m.length), new Float64Array(m.length)]
    const y = [new Float64Array(m.length), new Float64Array(m.length)]
    for (let review = 0; review < fsrsPlacements.length; review++) {
        const cardId = cardIds[review]
        let cluster = clusters.get(cardId)
        if (cluster === undefined) {
            cluster = clusters.size
            clusters.set(cardId, cluster)
        }
        if (actual[review] === 1) {
            m[cluster]++
            x[0][cluster] += fsrsPlacements[review]
            x[1][cluster] += rwkvPlacements[review]
        } else {
            n[cluster]++
            y[0][cluster] += fsrsPlacements[review]
            y[1][cluster] += rwkvPlacements[review]
        }
    }
    const I = clusters.size
    let I10 = 0
    let I01 = 0
    for (let i = 0; i < I; i++) {
        if (m[i] > 0) I10++
        if (n[i] > 0) I01++
    }
    if (I10 < 2 || I01 < 2 || I < 2) return undefined

    const aucs = [fsrs.auc, rwkv.auc]
    const covariance = (k: number, l: number) => {
        let sum10 = 0
        let sum01 = 0
        let sum11 = 0
        for (let i = 0; i < I; i++) {
            const xk = x[k][i] - m[i] * aucs[k]
            const xl = x[l][i] - m[i] * aucs[l]
            const yk = y[k][i] - n[i] * aucs[k]
            const yl = y[l][i] - n[i] * aucs[l]
            sum10 += xk * xl
            sum01 += yk * yl
            sum11 += xk * yl + xl * yk
        }
        return (
            (I10 * sum10) / ((I10 - 1) * M * M) +
            (I01 * sum01) / ((I01 - 1) * N * N) +
            (I * sum11) / ((I - 1) * M * N)
        )
    }
    const fsrsVariance = Math.max(0, covariance(0, 0))
    const rwkvVariance = Math.max(0, covariance(1, 1))
    fsrs.interval = aucInterval(fsrs.auc, fsrsVariance, 0)
    rwkv.interval = aucInterval(rwkv.auc, rwkvVariance, 0)
    const value = fsrs.auc - rwkv.auc
    return {
        value,
        interval: aucInterval(value, fsrsVariance + rwkvVariance - 2 * covariance(0, 1), -1),
    }
}
