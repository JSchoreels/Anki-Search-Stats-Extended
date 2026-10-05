// Object/map implementation preserved before the columnar migration.
import type { CalibrationSampleInput as CalibrationSample } from "../../src/ts/calibrationSamples"

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

/**
 * Groups paired predictions by their signed disagreement (FSRS minus RWKV), then
 * measures each model's mean prediction error inside the shared bins.
 */
export function buildUmPlusData(
    samples: CalibrationSample[],
    fsrsPredictions: Record<number, number>,
    rwkvPredictions: Record<number, number>
): UmPlusData {
    const sumDisagreement = Array<number>(UM_PLUS_BIN_COUNT).fill(0)
    const sumFsrsError = Array<number>(UM_PLUS_BIN_COUNT).fill(0)
    const sumRwkvError = Array<number>(UM_PLUS_BIN_COUNT).fill(0)
    const counts = Array<number>(UM_PLUS_BIN_COUNT).fill(0)
    const offset = UM_PLUS_BINS_PER_UNIT

    for (const sample of samples) {
        const fsrs = fsrsPredictions[sample.revlogId]
        const rwkv = rwkvPredictions[sample.revlogId]
        if (!isProbability(fsrs) || !isProbability(rwkv) || !isProbability(sample.actual)) {
            continue
        }

        const disagreement = fsrs - rwkv
        const index = Math.max(
            0,
            Math.min(
                UM_PLUS_BIN_COUNT - 1,
                Math.round(disagreement * UM_PLUS_BINS_PER_UNIT) + offset
            )
        )
        sumDisagreement[index] += disagreement
        sumFsrsError[index] += fsrs - sample.actual
        sumRwkvError[index] += rwkv - sample.actual
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

    return {
        bins,
        fsrsScore: weightedRmse(bins, (bin) => bin.fsrsError, count),
        rwkvScore: weightedRmse(bins, (bin) => bin.rwkvError, count),
        count,
    }
}
