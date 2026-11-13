import { calibrationSamplesFrom } from "../src/ts/calibrationSamples"
import type { Revlog } from "../src/ts/cardData"
import { buildDailyPredictionData, dailyPredictionValue } from "../src/ts/dailyPredictionData"
import {
    applyDailyActualRecall,
    dailyActualRecall,
    dailyRecallModelReviewWindows,
} from "../src/ts/dailyRecallGap"
import { dayFromMs } from "../src/ts/revlogGraphs"

const first = Date.UTC(2026, 8, 20, 12)
const next = first + 86_400_000
const review = (id: number, ease: number, type = 1): Revlog => ({
    id,
    cid: 100,
    ease: ease as Revlog["ease"],
    ivl: 1,
    lastIvl: 1,
    factor: 2500,
    time: 1000,
    type,
})
const history = [
    review(first + 1000, 1),
    review(first + 2000, 4),
    { ...review(first + 3000, 2, 3), time: 0 },
    review(next + 1000, 1),
    review(next + 2000, 3),
    review(next + 3000, 0, 4),
    review(next + 4000, 5),
    review(next + 5000, 1.5),
]
const samples = calibrationSamplesFrom([
    { revlogId: first + 2000, cardId: 100, actual: 1 },
    { revlogId: next + 1000, cardId: 100, actual: 0 },
])
const day1 = dayFromMs(first)
const day2 = dayFromMs(next)

test("daily actual recall includes all graded reviews, even without predictions", () => {
    const actual = dailyActualRecall(history)
    expect(actual).toEqual({
        [day1]: { count: 3, remembered: 2 },
        [day2]: { count: 2, remembered: 1 },
    })
    const predicted = buildDailyPredictionData(samples, new Float64Array([0.8, 0.2]))
    const points = applyDailyActualRecall(predicted, actual)
    expect(points.map(({ count, actualCount }) => [count, actualCount])).toEqual([
        [1, 3],
        [1, 2],
    ])
    expect(points[0].actualRecall).toBeCloseTo(2 / 3)
    expect(dailyPredictionValue(points[0], "rawGap")).toBeCloseTo((2 / 3 - 0.8) * 100)
    expect(dailyPredictionValue(points[1], "rawGap")).toBeCloseTo(30)
})

test("review windows use the last N total reviews and each model's available predictions", () => {
    const windows = dailyRecallModelReviewWindows(
        history,
        samples,
        [
            { model: "fsrs", predictions: new Float64Array([0.8, 0.2]) },
            { model: "rwkv-big", predictions: new Float64Array([0.4, NaN]) },
        ],
        3
    )
    expect(windows.fsrs.map((item) => item.day)).toEqual([day1, day2])
    expect(windows.fsrs[0].value).toBeCloseTo((2 / 3 - 0.8) * 100)
    expect(windows.fsrs[1].value).toBeCloseTo((2 / 3 - 0.2) * 100)
    expect(windows["rwkv-big"][0].value).toBeCloseTo((2 / 3 - 0.4) * 100)
    expect(windows["rwkv-big"][1].value).toBeNull()
})

test("certain predictions still produce a raw daily difference", () => {
    const points = applyDailyActualRecall(
        buildDailyPredictionData(samples, new Float64Array([1, 0])),
        dailyActualRecall(history)
    )
    expect(points.map((point) => point.standardizedGap)).toEqual([null, null])
    expect(dailyPredictionValue(points[0], "rawGap")).toBeCloseTo(-100 / 3)
    expect(dailyPredictionValue(points[1], "rawGap")).toBe(50)
})

test("models keep their own available prediction days while using all-review recall", () => {
    const actual = dailyActualRecall(history)
    const firstModel = applyDailyActualRecall(
        buildDailyPredictionData(samples, new Float64Array([0.8, NaN])),
        actual
    )
    const secondModel = applyDailyActualRecall(
        buildDailyPredictionData(samples, new Float64Array([NaN, 0.3])),
        actual
    )
    expect(firstModel.map((point) => [point.day, point.actualCount])).toEqual([[day1, 3]])
    expect(secondModel.map((point) => [point.day, point.actualCount])).toEqual([[day2, 2]])
    expect(dailyPredictionValue(firstModel[0], "rawGap")).toBeCloseTo((2 / 3 - 0.8) * 100)
    expect(dailyPredictionValue(secondModel[0], "rawGap")).toBeCloseTo(20)
})

test("history and model predictions may arrive out of order", () => {
    const reversed = calibrationSamplesFrom([
        { revlogId: next + 1000, cardId: 100, actual: 0 },
        { revlogId: first + 2000, cardId: 100, actual: 1 },
    ])
    const normal = dailyRecallModelReviewWindows(
        history,
        samples,
        [{ model: "m", predictions: new Float64Array([0.8, 0.2]) }],
        3
    )
    const shuffled = dailyRecallModelReviewWindows(
        [...history].reverse(),
        reversed,
        [{ model: "m", predictions: new Float64Array([0.2, 0.8]) }],
        3
    )
    expect(shuffled).toEqual(normal)
    expect(() => dailyRecallModelReviewWindows(history, samples, [], 0)).toThrow(
        "Invalid review window"
    )
})
