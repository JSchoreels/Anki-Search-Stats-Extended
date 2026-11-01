import {
    dailyMovingAverage,
    plottableDailyMovingAverage,
    studyDayMovingAverage,
} from "../src/ts/dailyMovingAverage"

test("plottable moving averages preserve calendar positions and missing-day gaps", () => {
    const values: number[] = []
    values[2] = 10
    values[3] = 20
    values[5] = 40

    const averaged = plottableDailyMovingAverage(values, 3)

    expect(averaged.slice(0, 6)).toEqual([NaN, NaN, 10, 15, NaN, 30])
    expect(values).toEqual([, , 10, 20, , 40])
})

test("a one-day line average matches finite values and validates its window", () => {
    expect(plottableDailyMovingAverage([10, 20, 30], 1)).toEqual([10, 20, 30])
    expect(() => dailyMovingAverage([10], 0)).toThrow("Invalid moving average window")
})

test("study-day averages use the latest available days without filling missing values", () => {
    expect(studyDayMovingAverage([10, null, 20, 0, null, 40], 2)).toEqual([
        10,
        null,
        15,
        10,
        null,
        20,
    ])
    expect(() => studyDayMovingAverage([1], 0)).toThrow("Invalid moving average window")
})
