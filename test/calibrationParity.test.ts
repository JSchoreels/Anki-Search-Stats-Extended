import { alignPredictions, calibrationSamplesFrom } from "../src/ts/calibrationSamples"
import {
    buildCalibrationBinCounts,
    buildCalibrationBins,
    withConfidenceIntervals,
} from "../src/ts/MemorisedBar"
import { buildRocData } from "../src/ts/rocData"
import { buildRwkvDailyData } from "../src/ts/rwkvDailyData"
import { runStatsTaskLocally } from "../src/ts/statsTasks"
import { buildUmPlusData } from "../src/ts/umPlusData"
import { buildCalibrationBins as referenceBins } from "./reference/calibrationBins"
import { buildRocData as referenceRoc } from "./reference/rocData"
import { buildRwkvDailyData as referenceDaily } from "./reference/rwkvDailyData"
import { buildUmPlusData as referenceUmPlus } from "./reference/umPlusData"

test.each([0, 1, 4_096, 20_000])(
    "columnar calculations exactly match object/map loops for %i samples",
    (count) => {
        let state = 0x12345678 + count
        const random = () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0
            return state / 4294967296
        }
        const randomPrediction = () => {
            const value = random()
            return value < 0.05
                ? NaN
                : value < 0.1
                  ? Infinity
                  : value < 0.15
                    ? -0.1
                    : value < 0.2
                      ? 1.1
                      : value < 0.25
                        ? 0
                        : value < 0.3
                          ? 1
                          : value < 0.5
                            ? Math.round(random() * 20) / 20
                            : random()
        }
        const samples = calibrationSamplesFrom(
            Array.from({ length: count }, (_, i) => ({
                revlogId: Date.UTC(2026, 8, 1) + Math.floor(random() * 30) * 86400000 + i,
                cardId: Math.floor(random() * 100) + 1,
                actual: random() < 0.7 ? 1 : 0,
            }))
        )
        const fsrs = new Float64Array(Array.from({ length: count }, randomPrediction))
        const rwkv = new Float64Array(Array.from({ length: count }, randomPrediction))
        // Convert to the old shape and run independently preserved pre-migration loops.
        const list = Array.from(samples.revlogIds, (revlogId, i) => ({
            revlogId,
            cardId: samples.cardIds[i],
            actual: samples.actual[i],
        }))
        const fsrsMap = Object.fromEntries(list.map((sample, i) => [sample.revlogId, fsrs[i]]))
        const rwkvMap = Object.fromEntries(list.map((sample, i) => [sample.revlogId, rwkv[i]]))
        expect(buildCalibrationBins(samples, fsrs)).toEqual(referenceBins(list, fsrsMap))
        expect(buildCalibrationBins(samples, rwkv)).toEqual(referenceBins(list, rwkvMap))
        expect(buildUmPlusData(samples, fsrs, rwkv)).toEqual(
            referenceUmPlus(list, fsrsMap, rwkvMap)
        )
        expect(buildRocData(samples, fsrs, rwkv)).toEqual(referenceRoc(list, fsrsMap, rwkvMap))
        expect(buildRwkvDailyData(samples, rwkv)).toEqual(referenceDaily(list, rwkvMap))
        expect(runStatsTaskLocally("comparison", [samples, fsrs, rwkv])).toEqual({
            umPlus: referenceUmPlus(list, fsrsMap, rwkvMap),
            roc: referenceRoc(list, fsrsMap, rwkvMap),
            rwkvDaily: referenceDaily(list, rwkvMap),
        })
    }
)

test("prediction and replay tasks share alignment and calibration bin calculations", () => {
    const samples = calibrationSamplesFrom([
        { revlogId: 10, cardId: 1, actual: 1 },
        { revlogId: 20, cardId: 2, actual: 0 },
        { revlogId: 30, cardId: 1, actual: 1 },
    ])
    const predictions = alignPredictions(samples, { 10: 0.9, 20: 0.2, 999: 0.5 })
    const bins = buildCalibrationBinCounts(samples, predictions)
    const intervals = runStatsTaskLocally("calibrationBands", [samples, predictions])
    expect(withConfidenceIntervals(bins, intervals)).toEqual(
        runStatsTaskLocally("calibrationReplay", [samples, predictions])
    )
    expect(
        runStatsTaskLocally("calibrationPredictions", [
            samples,
            JSON.stringify({
                data: [
                    [10, "0.9"],
                    [20, 0.2],
                    [999, 0.5],
                ],
                refresh_after_fsrs: true,
            }),
        ])
    ).toEqual({
        column: null,
        predictions,
        responsePredictionCount: 3,
        bins,
        warnings: [],
        roles: [],
        roleCounts: {},
        refreshAfterFsrs: true,
    })
})
