import { type CalibrationSamples, sampleCount } from "./calibrationSamples"

export const UM_PLUS_BINS_PER_UNIT = 20
export const UM_PLUS_BIN_COUNT = 2 * UM_PLUS_BINS_PER_UNIT + 1
export const UM_PLUS_SMALL_BUCKET_THRESHOLD = 200

export type UmPlusBin = {
    index: number
    disagreement: number
    fsrsError: number
    rwkvError: number
    count: number
}

export type UmPlusData = {
    bins: UmPlusBin[]
    fsrsScore: number
    rwkvScore: number
    count: number
    disagreementPercentiles: { percentile: number; absoluteDisagreement: number }[]
}

export function visibleUmPlusBins(bins: UmPlusBin[], showSmallBuckets: boolean): UmPlusBin[] {
    return showSmallBuckets
        ? bins
        : bins.filter((bin) => bin.count >= UM_PLUS_SMALL_BUCKET_THRESHOLD)
}

function roundedTenthDomain(values: number[], fallback: [number, number]): [number, number] {
    if (values.length === 0) {
        return fallback
    }
    const step = 0.1
    const tolerance = 1e-10
    const min = Math.min(...values)
    const max = Math.max(...values)
    let lower = Math.max(-1, Math.floor((min + tolerance) / step) * step)
    let upper = Math.min(1, Math.ceil((max - tolerance) / step) * step)

    if (Math.abs(upper - lower) < tolerance) {
        lower = Math.max(-1, lower - step)
        upper = Math.min(1, upper + step)
    }

    return [Number(lower.toFixed(1)), Number(upper.toFixed(1))]
}

export function umPlusDisagreementDomain(bins: UmPlusBin[]): [number, number] {
    return roundedTenthDomain(
        bins.map((bin) => bin.disagreement),
        [-1, 1]
    )
}

export function umPlusErrorDomain(bins: UmPlusBin[]): [number, number] {
    if (bins.length === 0) {
        return [-0.1, 0.1]
    }

    let [lower, upper] = roundedTenthDomain(
        [0, ...bins.flatMap((bin) => [bin.fsrsError, bin.rwkvError])],
        [-0.1, 0.1]
    )
    if (lower === 0) {
        lower = -0.1
    }
    if (upper === 0) {
        upper = 0.1
    }
    return [lower, upper]
}

function isProbability(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

function weightedRmse(bins: UmPlusBin[], error: (bin: UmPlusBin) => number, count: number) {
    if (count === 0) {
        return 0
    }
    return Math.sqrt(bins.reduce((sum, bin) => sum + bin.count * error(bin) ** 2, 0) / count)
}

export function weightedRegressionSlope(
    bins: UmPlusBin[],
    value: (bin: UmPlusBin) => number
): number | undefined {
    const count = bins.reduce((sum, bin) => sum + bin.count, 0)
    if (count === 0) {
        return undefined
    }

    const meanX = bins.reduce((sum, bin) => sum + bin.count * bin.disagreement, 0) / count
    const meanY = bins.reduce((sum, bin) => sum + bin.count * value(bin), 0) / count
    const covariance = bins.reduce(
        (sum, bin) => sum + bin.count * (bin.disagreement - meanX) * (value(bin) - meanY),
        0
    )
    const variance = bins.reduce((sum, bin) => sum + bin.count * (bin.disagreement - meanX) ** 2, 0)

    return variance > 1e-12 ? covariance / variance : undefined
}

/**
 * Groups paired predictions by their signed disagreement (FSRS minus RWKV), then
 * measures each model's mean prediction error inside the shared bins.
 */
export function buildUmPlusData(
    samples: CalibrationSamples,
    fsrsPredictions: Float64Array,
    rwkvPredictions: Float64Array
): UmPlusData {
    const sumDisagreement = Array<number>(UM_PLUS_BIN_COUNT).fill(0)
    const sumFsrsError = Array<number>(UM_PLUS_BIN_COUNT).fill(0)
    const sumRwkvError = Array<number>(UM_PLUS_BIN_COUNT).fill(0)
    const counts = Array<number>(UM_PLUS_BIN_COUNT).fill(0)
    const absoluteDisagreements = new Float64Array(sampleCount(samples))
    let pairedCount = 0
    const offset = UM_PLUS_BINS_PER_UNIT

    for (let i = 0; i < sampleCount(samples); i++) {
        const fsrs = fsrsPredictions[i]
        const rwkv = rwkvPredictions[i]
        if (!isProbability(fsrs) || !isProbability(rwkv) || !isProbability(samples.actual[i])) {
            continue
        }

        const disagreement = fsrs - rwkv
        absoluteDisagreements[pairedCount++] = Math.abs(disagreement)
        const index = Math.max(
            0,
            Math.min(
                UM_PLUS_BIN_COUNT - 1,
                Math.round(disagreement * UM_PLUS_BINS_PER_UNIT) + offset
            )
        )
        sumDisagreement[index] += disagreement
        sumFsrsError[index] += fsrs - samples.actual[i]
        sumRwkvError[index] += rwkv - samples.actual[i]
        counts[index] += 1
    }

    const bins = counts.flatMap((count, index): UmPlusBin[] =>
        count === 0
            ? []
            : [
                  {
                      index,
                      disagreement: sumDisagreement[index] / count,
                      fsrsError: sumFsrsError[index] / count,
                      rwkvError: sumRwkvError[index] / count,
                      count,
                  },
              ]
    )
    const count = counts.reduce((sum, value) => sum + value, 0)
    const sortedDisagreements = absoluteDisagreements.subarray(0, count).sort()

    return {
        bins,
        fsrsScore: weightedRmse(bins, (bin) => bin.fsrsError, count),
        rwkvScore: weightedRmse(bins, (bin) => bin.rwkvError, count),
        count,
        // Nearest-rank thresholds include at least the named share of reviews.
        disagreementPercentiles:
            count === 0
                ? []
                : [68, 95, 99.7].map((percentile) => ({
                      percentile,
                      absoluteDisagreement:
                          sortedDisagreements[Math.ceil((percentile * count) / 100) - 1],
                  })),
    }
}
