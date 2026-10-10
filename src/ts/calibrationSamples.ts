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

// Collect eligible samples in numeric chunks instead of retaining growing JS
// arrays beside the final columns. Only Memorised replay supplies predictions.
const SAMPLE_CHUNK_SIZE = 16384
export class CalibrationSampleBuilder {
    private chunks: { samples: CalibrationSamples; predictions?: Float64Array }[] = []
    private length = 0
    constructor(private withPredictions = false) {}

    add(revlogId: number, cardId: number, actual: number, prediction = NaN) {
        const offset = this.length % SAMPLE_CHUNK_SIZE
        if (offset === 0)
            this.chunks.push({
                samples: {
                    revlogIds: new Float64Array(SAMPLE_CHUNK_SIZE),
                    cardIds: new Float64Array(SAMPLE_CHUNK_SIZE),
                    actual: new Uint8Array(SAMPLE_CHUNK_SIZE),
                },
                predictions: this.withPredictions ? new Float64Array(SAMPLE_CHUNK_SIZE) : undefined,
            })
        const chunk = this.chunks[this.chunks.length - 1]
        chunk.samples.revlogIds[offset] = revlogId
        chunk.samples.cardIds[offset] = cardId
        chunk.samples.actual[offset] = actual
        if (chunk.predictions) chunk.predictions[offset] = prediction
        this.length++
    }

    finish() {
        const samples = {
            revlogIds: new Float64Array(this.length),
            cardIds: new Float64Array(this.length),
            actual: new Uint8Array(this.length),
        }
        const predictions = new Float64Array(this.withPredictions ? this.length : 0)
        let offset = 0
        for (const chunk of this.chunks) {
            const count = Math.min(SAMPLE_CHUNK_SIZE, this.length - offset)
            samples.revlogIds.set(chunk.samples.revlogIds.subarray(0, count), offset)
            samples.cardIds.set(chunk.samples.cardIds.subarray(0, count), offset)
            samples.actual.set(chunk.samples.actual.subarray(0, count), offset)
            if (chunk.predictions) predictions.set(chunk.predictions.subarray(0, count), offset)
            offset += count
        }
        this.chunks = []
        this.length = 0
        return { samples, predictions }
    }
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
