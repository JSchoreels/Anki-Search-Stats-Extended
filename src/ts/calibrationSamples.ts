export type CalibrationSamples = {
    revlogIds: Float64Array
    cardIds: Float64Array
    actual: Uint8Array
}

export type CalibrationSampleInput = { revlogId: number; cardId: number; actual: number }

export const EMPTY_CALIBRATION_SAMPLES: CalibrationSamples = {
    revlogIds: new Float64Array(0),
    cardIds: new Float64Array(0),
    actual: new Uint8Array(0),
}

export function calibrationSamplesFrom(list: CalibrationSampleInput[]): CalibrationSamples {
    const revlogIds = new Float64Array(list.length)
    const cardIds = new Float64Array(list.length)
    const actual = new Uint8Array(list.length)
    for (let i = 0; i < list.length; i++) {
        revlogIds[i] = list[i].revlogId
        cardIds[i] = list[i].cardId
        actual[i] = list[i].actual
    }
    return { revlogIds, cardIds, actual }
}

export function sampleCount(samples: CalibrationSamples): number {
    return samples.revlogIds.length
}

// NaN distinguishes missing predictions from a valid zero probability.
export function alignPredictions(
    samples: CalibrationSamples,
    byRevlogId: Record<number, number> | Map<number, number>
): Float64Array {
    const predictions = new Float64Array(sampleCount(samples))
    for (let i = 0; i < predictions.length; i++) {
        const id = samples.revlogIds[i]
        predictions[i] = (byRevlogId instanceof Map ? byRevlogId.get(id) : byRevlogId[id]) ?? NaN
    }
    return predictions
}

// Replay predictions come from parameters usually fitted on these reviews, so
// FSRS vs RWKV comparisons only use held-out cached FSRS predictions.
export function heldOutFsrsPredictions(fsrs: {
    cachedPredictionCount: number
    predictions: Float64Array
}): Float64Array {
    return fsrs.cachedPredictionCount > 0
        ? fsrs.predictions
        : new Float64Array(fsrs.predictions.length).fill(NaN)
}

export function countPredictions(predictions: Float64Array): number {
    let count = 0
    for (const value of predictions) {
        if (Number.isFinite(value) && value >= 0 && value <= 1) count++
    }
    return count
}
