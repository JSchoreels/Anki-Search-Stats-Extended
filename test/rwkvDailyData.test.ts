import { dayToMs } from "../src/ts/revlogGraphs"
import { buildRwkvDailyData } from "../src/ts/rwkvDailyData"
import { calibrationInputs } from "./calibrationInputs"

const firstDay = 20000
const review = (day: number, index: number, actual: number) => ({
    revlogId: dayToMs(day) + 1000 + index,
    cardId: index + 1,
    actual,
})

test("daily scores use each review's probability and average recall on the identical sample", () => {
    const remembered = review(firstDay, 0, 1)
    const forgotten = review(firstDay, 1, 0)
    const [point] = buildRwkvDailyData(
        ...calibrationInputs([remembered, forgotten], {
            [remembered.revlogId]: 0.9,
            [forgotten.revlogId]: 0.5,
        })
    )

    expect(point).toMatchObject({
        day: firstDay,
        count: 2,
        actualRecall: 0.5,
        predictedRecall: 0.7,
    })
    expect(point.standardizedGap).toBeCloseTo(-0.4 / Math.sqrt(0.09 + 0.25))
    expect(point.logLoss).toBeCloseTo((-Math.log2(0.9) - Math.log2(0.5)) / 2)
})

test("the same retention gap is more unexpected across more reviews while average loss stays equal", () => {
    const samples = [20, 200].flatMap((count, day) =>
        Array.from({ length: count }, (_, index) =>
            review(firstDay + day, index, index < count * 0.8 ? 1 : 0)
        )
    )
    const predictions = Object.fromEntries(samples.map((sample) => [sample.revlogId, 0.9]))
    const [small, large] = buildRwkvDailyData(...calibrationInputs(samples, predictions))

    expect(small.standardizedGap).toBeCloseTo(-1.490712)
    expect(large.standardizedGap).toBeCloseTo(-4.714045)
    expect(small.logLoss).toBeCloseTo(large.logLoss)
})

test("confident mistakes and unlikely successes both increase surprise", () => {
    const samples = [0, 0, 1].map((actual, index) => review(firstDay + index, 0, actual))
    const points = buildRwkvDailyData(
        ...calibrationInputs(samples, {
            [samples[0].revlogId]: 0.99,
            [samples[1].revlogId]: 0.6,
            [samples[2].revlogId]: 0.01,
        })
    )

    expect(points[0].logLoss).toBeCloseTo(6.643856)
    expect(points[1].logLoss).toBeCloseTo(1.321928)
    expect(points[2].logLoss).toBeCloseTo(6.643856)
    expect(points[0].standardizedGap).toBeLessThan(0)
    expect(points[2].standardizedGap).toBeGreaterThan(0)
})

test("missing and invalid predictions or outcomes are excluded, leaving sorted sparse days", () => {
    const samples = [1, 0, 1, 0, 0, 0, 2].map((actual, index) =>
        review(firstDay + index, 0, actual)
    )
    const predictions = {
        [samples[0].revlogId]: 0.8,
        [samples[2].revlogId]: 0.7,
        [samples[3].revlogId]: NaN,
        [samples[4].revlogId]: -0.1,
        [samples[5].revlogId]: 1.1,
        [samples[6].revlogId]: 0.5,
    }
    expect(
        buildRwkvDailyData(...calibrationInputs([...samples].reverse(), predictions)).map(
            (point) => point.day
        )
    ).toEqual([firstDay, firstDay + 2])
    expect(buildRwkvDailyData(...calibrationInputs(samples, {}))).toEqual([])
    expect(buildRwkvDailyData(...calibrationInputs([], predictions))).toEqual([])
})

test("deterministic probabilities retain exact recall and finite loss but have no standardized gap", () => {
    const samples = [1, 0, 0, 1].map((actual, index) =>
        review(firstDay + Math.floor(index / 2), index, actual)
    )
    const [correct, wrong] = buildRwkvDailyData(
        ...calibrationInputs(
            samples,
            Object.fromEntries(
                samples.map((sample, index) => [sample.revlogId, index % 2 === 0 ? 1 : 0])
            )
        )
    )

    expect(correct).toMatchObject({
        standardizedGap: null,
        logLoss: 0,
        actualRecall: 0.5,
        predictedRecall: 0.5,
    })
    expect(wrong).toMatchObject({ standardizedGap: null, actualRecall: 0.5, predictedRecall: 0.5 })
    expect(wrong.logLoss).toBeCloseTo(-Math.log2(1e-15))
})

test("reviews on either side of Anki's 4am rollover belong to different days", () => {
    const previous = global.SSEother
    try {
        global.SSEother = { ...previous, rollover: 4 }
        jest.isolateModules(() => {
            const { buildRwkvDailyData } = require("../src/ts/rwkvDailyData")
            // Match the add-on's current-offset convention even when this test runs in winter.
            const boundary = Date.UTC(2026, 8, 27, 4) + new Date().getTimezoneOffset() * 60000
            const before = boundary - 60000
            const after = boundary + 60000
            const data = buildRwkvDailyData(
                ...calibrationInputs(
                    [
                        { revlogId: before, cardId: 1, actual: 1 },
                        { revlogId: after, cardId: 2, actual: 0 },
                    ],
                    { [before]: 0.8, [after]: 0.8 }
                )
            )
            expect(
                data.map((point: { day: number; count: number }) => [point.day, point.count])
            ).toEqual([
                [Math.floor(Date.UTC(2026, 8, 26) / 86400000), 1],
                [Math.floor(Date.UTC(2026, 8, 27) / 86400000), 1],
            ])
        })
    } finally {
        global.SSEother = previous
    }
})
