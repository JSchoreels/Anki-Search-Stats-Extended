import { CalibrationSampleBuilder } from "../src/ts/calibrationSamples"
import { resultTransfers } from "../src/ts/workerTransfers"

test.each([false, true])(
    "sample chunks preserve exact selection, order and predictions across boundaries (predictions=%s)",
    (withPredictions) => {
        const builder = new CalibrationSampleBuilder(withPredictions)
        const count = 33001
        const ids = Float64Array.from({ length: count }, (_, i) => 1791659375463 + i)
        const cids = Float64Array.from({ length: count }, (_, i) => 1730212469023 + (i % 23))
        const actual = Uint8Array.from({ length: count }, (_, i) => i % 2)
        const predicted = Float64Array.from({ length: count }, (_, i) => (i % 7 ? i / count : NaN))
        for (let i = 0; i < count; i++) builder.add(ids[i], cids[i], actual[i], predicted[i])
        const result = builder.finish()
        expect(result.samples).toEqual({ revlogIds: ids, cardIds: cids, actual })
        expect(result.predictions).toEqual(withPredictions ? predicted : new Float64Array(0))
        const delivered = structuredClone(result, { transfer: resultTransfers(result) })
        expect(result.samples.revlogIds.byteLength).toBe(0)
        expect(delivered.samples.revlogIds[16384]).toBe(ids[16384])
        builder.add(123, 456, 0, 0)
        const next = builder.finish()
        expect(Array.from(next.samples.revlogIds)).toEqual([123])
        expect(Array.from(next.predictions)).toEqual(withPredictions ? [0] : [])
        expect(builder.finish().samples.revlogIds.length).toBe(0)
    }
)
