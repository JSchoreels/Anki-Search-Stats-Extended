import {
    alignPredictions,
    calibrationSamplesFrom,
    type CalibrationSampleInput,
    type CalibrationSamples,
} from "../src/ts/calibrationSamples"

// Convert readable object/map fixtures to the worker's columnar input shape.
export function calibrationInputs(
    list: CalibrationSampleInput[],
    predictions: Record<number, number>
): [CalibrationSamples, Float64Array]
export function calibrationInputs(
    list: CalibrationSampleInput[],
    fsrs: Record<number, number>,
    rwkv: Record<number, number>
): [CalibrationSamples, Float64Array, Float64Array]
export function calibrationInputs(
    list: CalibrationSampleInput[],
    ...maps: Record<number, number>[]
) {
    const samples = calibrationSamplesFrom(list)
    return [samples, ...maps.map((map) => alignPredictions(samples, map))]
}
