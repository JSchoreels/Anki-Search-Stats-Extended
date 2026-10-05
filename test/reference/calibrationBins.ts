// Object/map implementation preserved before the columnar migration.
import {
    type CalibrationBootstrapObservation,
    cardBootstrapConfidenceIntervals,
} from "../../src/ts/calibrationBootstrap"
import type { CalibrationSampleInput as CalibrationSample } from "../../src/ts/calibrationSamples"
import type { LossBin } from "../../src/ts/MemorisedBar"

export const CALIBRATION_BIN_COUNT = 20

const default_bin = { predicted: 0, real: 0, count: 0 }

function incrementLoss(bin: LossBin | null | undefined, predicted: number, real: number) {
    bin ??= { ...default_bin }

    bin.predicted = (bin.predicted || 0) + predicted
    bin.real = (bin.real || 0) + real
    bin.count = (bin.count || 0) + 1

    return bin
}

function isValidProbability(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

export function calibrationBinIndex(predicted: number, binCount = CALIBRATION_BIN_COUNT) {
    return Math.max(
        0,
        Math.min(binCount - 1, Math.floor(Math.exp(Math.log(binCount + 1) * predicted)) - 1)
    )
}

export function addCalibrationSample(bins: LossBin[], predicted: number, actual: number) {
    if (!isValidProbability(predicted) || !isValidProbability(actual)) {
        return false
    }

    const bin = calibrationBinIndex(predicted, bins.length || CALIBRATION_BIN_COUNT)
    bins[bin] = incrementLoss(bins[bin], predicted, actual)
    return true
}

export function buildCalibrationBins(
    samples: CalibrationSample[],
    predictionsByRevlogId: Record<number, number>
) {
    const bins = <LossBin[]>Array(CALIBRATION_BIN_COUNT)
    const observations: CalibrationBootstrapObservation[] = []

    for (const sample of samples) {
        const predicted = predictionsByRevlogId[sample.revlogId]
        if (addCalibrationSample(bins, predicted, sample.actual)) {
            observations.push({
                cardId: sample.cardId,
                bin: calibrationBinIndex(predicted),
                actual: sample.actual,
            })
        }
    }

    const confidenceIntervals = cardBootstrapConfidenceIntervals(
        observations,
        CALIBRATION_BIN_COUNT
    )
    for (let bin = 0; bin < bins.length; bin++) {
        if (bins[bin] && confidenceIntervals[bin]) {
            bins[bin].confidenceInterval = confidenceIntervals[bin]
        }
    }

    return bins
}
