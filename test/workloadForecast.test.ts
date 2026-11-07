/** @jest-environment jsdom */
jest.mock("../src/ts/i18n", () => ({
    i18n: (key: string, args?: Record<string, unknown>) => `${key} ${JSON.stringify(args ?? {})}`,
}))
jest.mock("../src/ts/stores", () => ({
    tooltip: { set: jest.fn() },
    tooltipShown: { set: jest.fn() },
}))

import {
    buildForecastPoints,
    forecastProgressFraction,
    forecastTotalMean,
    type ForecastBands,
    type WorkloadForecastResult,
} from "../src/ts/workloadForecastData"
import { workloadForecastTooltip } from "../src/ts/WorkloadForecastGraph"

const bands = (mean: number, spread: number): ForecastBands => ({
    mean,
    p1: mean - 2 * spread,
    p5: mean - spread,
    p50: mean,
    p95: mean + spread,
    p99: mean + 2 * spread,
})

const result: WorkloadForecastResult = {
    version: 1,
    days: 3,
    paths: 20,
    cards: 100,
    daily: [
        // Deliberately out of order.
        {
            day: 1,
            due: bands(80, 5),
            done: bands(70, 5),
            new: bands(10, 0),
            lapses: bands(7, 2),
            seconds: bands(600, 60),
        },
        {
            day: 0,
            due: bands(90, 0),
            done: bands(80, 0),
            new: bands(10, 0),
            lapses: bands(8, 1),
            seconds: bands(720, 30),
        },
        {
            day: 2,
            due: bands(60, 12),
            done: bands(60, 12),
            new: bands(10, 0),
            lapses: bands(6, 3),
            seconds: bands(540, 120),
        },
    ],
}

test("points are sorted by day and read the chosen metric", () => {
    const points = buildForecastPoints(result, "done")
    expect(points.map((p) => p.day)).toEqual([0, 1, 2])
    expect(points.map((p) => p.mean)).toEqual([80, 70, 60])
    expect(points[2]).toMatchObject({ p1: 36, p5: 48, p50: 60, p95: 72, p99: 84 })
})

test("bands widen with the horizon in the source data", () => {
    const points = buildForecastPoints(result, "due")
    const widths = points.map((p) => p.p99 - p.p1)
    expect(widths[0]).toBe(0)
    expect(widths[1]).toBeGreaterThan(widths[0])
    expect(widths[2]).toBeGreaterThan(widths[1])
})

test("time is shown in minutes", () => {
    const points = buildForecastPoints(result, "minutes")
    expect(points[0].mean).toBe(12)
    expect(points[0].p95).toBe(12.5)
})

test("missing or malformed data gives empty or zeroed points and ordered bands", () => {
    expect(buildForecastPoints(null, "due")).toEqual([])
    expect(buildForecastPoints({ ...result, daily: [] }, "due")).toEqual([])
    const odd = {
        ...result,
        daily: [{ day: 0, due: { mean: NaN, p1: 5, p5: 3, p95: 2, p99: 1 } }],
    } as unknown as WorkloadForecastResult
    const [point] = buildForecastPoints(odd, "due")
    expect(point.mean).toBe(0)
    expect(point.p1).toBeLessThanOrEqual(point.p5)
    expect(point.p99).toBeGreaterThanOrEqual(point.p95)
})

test("total is the sum of daily means", () => {
    expect(forecastTotalMean(buildForecastPoints(result, "done"))).toBe(210)
})

test("progress fraction is bounded", () => {
    expect(forecastProgressFraction(null)).toBe(0)
    expect(forecastProgressFraction({ current: 5, total: 20 })).toBe(0.25)
    expect(forecastProgressFraction({ current: 30, total: 20 })).toBe(1)
    expect(forecastProgressFraction({ current: 1, total: 0 })).toBe(0)
})

test("tooltip names the day and lists mean, median and both bands", () => {
    const [today, tomorrow] = buildForecastPoints(result, "done")
    const lines = workloadForecastTooltip(tomorrow, "done")
    expect(lines).toHaveLength(5)
    expect(lines[0]).toContain("workload-forecast-tomorrow")
    expect(lines[1]).toContain('"value":"70"')
    expect(lines[3]).toContain('"low":"65","high":"75"')
    expect(lines[4]).toContain('"low":"60","high":"80"')
    expect(workloadForecastTooltip(today, "done")[0]).toContain("workload-forecast-today")
    expect(workloadForecastTooltip(buildForecastPoints(result, "minutes")[0], "minutes")[1]).toContain(
        '"value":"12.0"'
    )
})
