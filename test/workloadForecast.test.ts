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
    forecastScenarioTotals,
    forecastTotalMean,
    type ForecastBands,
    type WorkloadForecastResult,
} from "../src/ts/workloadForecastData"
import {
    renderWorkloadForecastGraph,
    workloadForecastTooltip,
} from "../src/ts/WorkloadForecastGraph"

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

test("scenario chart uses the unshifted R path even when it is outside the other two", () => {
    const scenarioResult: WorkloadForecastResult = {
        ...result,
        paths: 3,
        scenario_sigma: 0.04,
        scenario_history_days: 42,
        scenario_daily: [
            {
                day: 0,
                due: [110, 130, 100],
                done: [90, 100, 80],
                new: [0, 1, 2],
                lapses: [4, 3, 2],
                seconds: [120, 180, 60],
            },
            {
                day: 1,
                due: [90, 70, 80],
                done: [60, 70, 80],
                new: [0, 1, 2],
                lapses: [3, 2, 1],
                seconds: [60, 120, 180],
            },
        ],
        daily: result.daily.filter((day) => day.day < 2),
    }
    const points = buildForecastPoints(scenarioResult, "due")
    expect(points.map((point) => point.mean)).toEqual([130, 70])
    expect(forecastTotalMean(points)).toBe(200)
    expect(points[0].scenarios).toEqual({ minus: 110, center: 130, plus: 100 })
    const tooltip = workloadForecastTooltip(points[0], "due")
    expect(tooltip[1]).toContain('"value":"130"')
    expect(tooltip[2]).toContain('"value":"110"')
    expect(tooltip[3]).toContain('"value":"100"')
    expect(buildForecastPoints(scenarioResult, "minutes")[0].scenarios).toEqual({
        minus: 2,
        center: 3,
        plus: 1,
    })

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    renderWorkloadForecastGraph(svg, points, "due")
    expect(svg.querySelector(".workload-forecast-scenario-minus")).not.toBeNull()
    expect(svg.querySelector(".workload-forecast-scenario-plus")).not.toBeNull()
    expect(svg.querySelector(".workload-forecast-band-p90")).toBeNull()
})

test("partial scenarios draw each day without inventing unavailable bounds", () => {
    const partial: WorkloadForecastResult = {
        ...result,
        paths: 3,
        partial: true,
        scenario_kind: "stratified",
        daily: [result.daily[1]],
        scenario_daily: [
            {
                day: 0,
                due: [110, 130, null],
                done: [90, 100, null],
                new: [0, 1, null],
                lapses: [4, 3, null],
                seconds: [120, 180, null],
            },
        ],
    }
    const points = buildForecastPoints(partial, "due")
    expect(points[0].mean).toBe(130)
    expect(points[0].scenarios).toEqual({ minus: 110, center: 130, plus: undefined })
    expect(points[0].scenarioKind).toBe("stratified")
    expect(workloadForecastTooltip(points[0], "due")).toHaveLength(3)
    expect(workloadForecastTooltip(points[0], "due")[1]).toContain("tooltip-stratum-center")
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    renderWorkloadForecastGraph(svg, points, "due", 30)
    expect(svg.querySelector(".workload-forecast-scenario-minus")?.getAttribute("d")).toBeTruthy()
    expect(svg.querySelector(".workload-forecast-scenario-plus")?.getAttribute("d")).toBeNull()
    expect(svg.querySelector(".workload-forecast-scenario-band")?.getAttribute("d")).toBeNull()
    expect(svg.querySelector("circle")).not.toBeNull()
    expect(svg.querySelector(".workload-forecast-scenario-point-minus")).not.toBeNull()
    expect(svg.querySelector(".workload-forecast-scenario-point-plus")).toBeNull()
    expect(svg.querySelector(".workload-forecast-scenario-spread")).toBeNull()
    partial.scenario_daily![0].due[2] = 100
    renderWorkloadForecastGraph(svg, buildForecastPoints(partial, "due"), "due", 30)
    expect(svg.querySelector(".workload-forecast-scenario-point-plus")).not.toBeNull()
    expect(svg.querySelector(".workload-forecast-scenario-spread")).not.toBeNull()
    const spread = svg.querySelector(".workload-forecast-scenario-spread")!
    const center = svg.querySelector("circle")!
    expect(Number(spread.getAttribute("y2"))).toBe(Number(center.getAttribute("cy")))
    expect(Number(spread.getAttribute("y1"))).toBeGreaterThan(Number(spread.getAttribute("y2")))
})

test("partial stochastic forecasts show their mean without premature percentile bands", () => {
    const points = buildForecastPoints({ ...result, partial: true }, "done")
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    renderWorkloadForecastGraph(svg, points, "done")
    expect(svg.querySelector(".workload-forecast-mean")).not.toBeNull()
    expect(svg.querySelector(".workload-forecast-band-p90")).toBeNull()
    expect(workloadForecastTooltip(points[0], "done")).toHaveLength(2)
})

test("progress fraction is bounded", () => {
    expect(forecastProgressFraction(null)).toBe(0)
    expect(forecastProgressFraction({ current: 5, total: 20 })).toBe(0.25)
    expect(forecastProgressFraction({ current: 30, total: 20 })).toBe(1)
    expect(forecastProgressFraction({ current: 1, total: 0 })).toBe(0)
})

test("tooltip names the day and lists mean, median and the 5-95 band for 20 paths", () => {
    const [today, tomorrow] = buildForecastPoints(result, "done")
    const lines = workloadForecastTooltip(tomorrow, "done")
    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain("workload-forecast-tomorrow")
    expect(lines[1]).toContain('"value":"70"')
    expect(lines[3]).toContain('"low":"65","high":"75"')
    expect(lines.join(" ")).not.toContain("workload-forecast-tooltip-p98")
    expect(workloadForecastTooltip(today, "done")[0]).toContain("workload-forecast-today")
    expect(
        workloadForecastTooltip(buildForecastPoints(result, "minutes")[0], "minutes")[1]
    ).toContain('"value":"12.0"')
})

test("the 1-99 band appears in the tooltip and graph only with 100 or more paths", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    renderWorkloadForecastGraph(svg, buildForecastPoints(result, "done"), "done")
    expect(svg.querySelector(".workload-forecast-band-p90")).not.toBeNull()
    expect(svg.querySelector(".workload-forecast-band-p98")).toBeNull()

    const wide = buildForecastPoints({ ...result, paths: 100 }, "done")
    const lines = workloadForecastTooltip(wide[1], "done")
    expect(lines).toHaveLength(5)
    expect(lines[4]).toContain('"low":"60","high":"80"')
    renderWorkloadForecastGraph(svg, wide, "done")
    expect(svg.querySelector(".workload-forecast-band-p90")).not.toBeNull()
    expect(svg.querySelector(".workload-forecast-band-p98")).not.toBeNull()
    const narrow = buildForecastPoints({ ...result, paths: 99 }, "done")
    expect(workloadForecastTooltip(narrow[1], "done")).toHaveLength(4)
})

test("three futures show an indicative standard deviation within the simulated limits", () => {
    // The three simulated values are 80, 100 and 100. These percentiles use
    // the backend's linear interpolation between sorted paths.
    const sampled: ForecastBands = {
        mean: 280 / 3,
        p1: 80.4,
        p5: 82,
        p50: 100,
        p95: 100,
        p99: 100,
    }
    const day = {
        day: 0,
        due: sampled,
        done: sampled,
        new: sampled,
        lapses: sampled,
        seconds: sampled,
    }
    const [point] = buildForecastPoints({ ...result, paths: 3, daily: [day] }, "done")
    const sd = Math.sqrt(((80 - 280 / 3) ** 2 + 2 * (100 - 280 / 3) ** 2) / 2)
    expect(point.estimatedRange?.low).toBeCloseTo(280 / 3 - sd)
    expect(point.estimatedRange?.high).toBeCloseTo(100)
    const tooltip = workloadForecastTooltip(point, "done")
    expect(tooltip).toHaveLength(3)
    expect(tooltip[2]).toContain("workload-forecast-tooltip-estimate")
    expect(tooltip.join(" ")).not.toContain("workload-forecast-tooltip-p90")

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    renderWorkloadForecastGraph(svg, [point], "done")
    expect(svg.querySelectorAll(".workload-forecast-estimate-band")).toHaveLength(1)
    expect(svg.querySelectorAll(".workload-forecast-estimate-bound")).toHaveLength(2)
    expect(svg.querySelector(".workload-forecast-band-p90")).toBeNull()
    expect(svg.querySelector(".workload-forecast-median")).toBeNull()
})

test("the three-future estimate scales answer time to minutes", () => {
    const sampled: ForecastBands = { mean: 120, p1: 61.2, p5: 66, p50: 120, p95: 174, p99: 178.8 }
    const day = {
        day: 0,
        due: sampled,
        done: sampled,
        new: sampled,
        lapses: sampled,
        seconds: sampled,
    }
    const [point] = buildForecastPoints({ ...result, paths: 3, daily: [day] }, "minutes")
    expect(point.mean).toBe(2)
    expect(point.estimatedRange?.low).toBeCloseTo(1)
    expect(point.estimatedRange?.high).toBeCloseTo(3)
})

const scenarioPoints = (triples: Array<[number | null, number | null, number | null]>) =>
    buildForecastPoints(
        {
            ...result,
            paths: 3,
            scenario_kind: "stratified",
            daily: triples.map((_, day) => ({ ...result.daily[1], day })),
            scenario_daily: triples.map((due, day) => ({
                day,
                due,
                done: due,
                new: due,
                lapses: due,
                seconds: due,
            })),
        },
        "due"
    )

test("scenario totals are exact for a symmetric linear dependence", () => {
    const totals = forecastScenarioTotals(
        scenarioPoints([
            [80, 100, 120],
            [40, 50, 60],
        ])
    )!
    expect(totals.low).toBe(120)
    expect(totals.central).toBe(150)
    expect(totals.high).toBe(180)
    expect(totals.expected).toBe(150)
    expect(totals.sd).toBe(30)
})

test("scenario totals add the curvature of a convex dependence", () => {
    // f(z) = 100 + 10 z + 5 z^2 evaluated at z = -1, 0, 1: E = 105, Var = 100 + 2 * 25.
    const totals = forecastScenarioTotals(scenarioPoints([[95, 100, 115]]))!
    expect(totals.expected).toBe(105)
    expect(totals.sd).toBeCloseTo(Math.sqrt(150))
    expect(totals.low).toBe(95)
    expect(totals.high).toBe(115)
})

test("scenario totals need every point to have all three finite values", () => {
    expect(forecastScenarioTotals([])).toBeNull()
    expect(
        forecastScenarioTotals(
            scenarioPoints([
                [80, 100, 120],
                [40, 50, null],
            ])
        )
    ).toBeNull()
    expect(forecastScenarioTotals(buildForecastPoints(result, "due"))).toBeNull()
})
