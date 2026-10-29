/** @jest-environment jsdom */

jest.mock("../src/ts/i18n", () => ({
    i18n: (key: string, args?: Record<string, string | number>) =>
        `${key}${args ? ": " + Object.values(args).join(", ") : ""}`,
}))
jest.mock("../src/ts/stores", () => ({
    tooltip: { set: jest.fn() },
    tooltipShown: { set: jest.fn() },
}))

import {
    dailyPredictionTooltip,
    renderDailyPredictionGraph as render,
} from "../src/ts/DailyPredictionGraph"
import type { DailyPredictionPoint } from "../src/ts/dailyPredictionData"
import { tooltip, tooltipShown } from "../src/ts/stores"

const point = (day: number, standardizedGap: number | null = 0): DailyPredictionPoint => ({
    day,
    count: 20,
    actualRecall: 0.8,
    predictedRecall: 0.9,
    standardizedGap,
    logLoss: 0.786,
})
const renderDailyPredictionGraph = (
    svg: SVGElement,
    data: DailyPredictionPoint[],
    metric: "standardizedGap" | "logLoss"
) => render(svg, [{ model: "rwkv", data }], metric)
const svgElement = () => document.createElementNS("http://www.w3.org/2000/svg", "svg")

test("rounding near-zero gaps does not display negative zero", () => {
    expect(dailyPredictionTooltip(point(20000, -1e-12), "standardizedGap")[1]).toBe(
        "daily-prediction-standardizedGap-value: 0.000"
    )
    expect(dailyPredictionTooltip({ ...point(20000), actualRecall: 0.89999 }, "rawGap")[1]).toBe(
        "daily-prediction-rawGap-value: 0.0"
    )
})

test("raw differences show signed percentage points and smooth the selected view", () => {
    const svg = svgElement()
    const data = [
        { ...point(20000), actualRecall: 0.6, predictedRecall: 0.4 },
        { ...point(20001, null), actualRecall: 0.5, predictedRecall: 0.7 },
        { ...point(20002), actualRecall: 0.65, predictedRecall: 0.7 },
    ]
    render(svg, [{ model: "fsrs", data }], "rawGap", 2)

    const zeroY = Number(svg.querySelector(".daily-prediction-zero")!.getAttribute("y1"))
    const points = [...svg.querySelectorAll(".daily-prediction-point")]
    expect(points).toHaveLength(3)
    expect(Number(points[0].getAttribute("cy"))).toBeLessThan(zeroY)
    expect(Number(points[1].getAttribute("cy"))).toBeGreaterThan(zeroY)
    expect(svg.textContent).toContain("daily-prediction-rawGap-axis")
    const secondDay = svg.querySelectorAll(".daily-prediction-hover")[1]
    expect(secondDay.getAttribute("aria-label")).toContain("daily-prediction-rawGap-value: -20.0")
    expect(secondDay.getAttribute("aria-label")).toContain(
        "daily-prediction-rawGap-average-value: 2, 0.0"
    )

    render(svg, [{ model: "fsrs", data }], "rawGap", 2, { start: 20002, end: 20002 })
    expect(svg.querySelector(".daily-prediction-hover")!.getAttribute("aria-label")).toContain(
        "daily-prediction-rawGap-average-value: 2, -12.5"
    )
})

test("recall gaps render on both sides of zero and do not join across missing days", () => {
    const svg = svgElement()
    renderDailyPredictionGraph(
        svg,
        [point(20000, -2), point(20001, 0), point(20003, 2)],
        "standardizedGap"
    )

    const zeroY = Number(svg.querySelector(".daily-prediction-zero")!.getAttribute("y1"))
    const points = [...svg.querySelectorAll(".daily-prediction-point")]
    expect(points).toHaveLength(3)
    expect(Number(points[0].getAttribute("cy"))).toBeGreaterThan(zeroY)
    expect(Number(points[1].getAttribute("cy"))).toBe(zeroY)
    expect(Number(points[2].getAttribute("cy"))).toBeLessThan(zeroY)
    expect(
        svg.querySelector(".daily-prediction-series")!.getAttribute("d")!.match(/M/g)
    ).toHaveLength(2)
    expect(svg.querySelectorAll(".daily-prediction-hover")).toHaveLength(3)
    expect(svg.textContent).toContain("daily-prediction-standardizedGap-axis")
})

test("tooltips expose metric, actual R, predicted R and count through hover and keyboard focus", () => {
    const svg = svgElement()
    renderDailyPredictionGraph(svg, [point(20000, -1.490712)], "standardizedGap")
    const target = svg.querySelector(".daily-prediction-hover")!
    expect(target.getAttribute("tabindex")).toBe("0")
    target.dispatchEvent(new MouseEvent("mouseover", { clientX: 100, clientY: 100 }))
    expect(tooltip.set).toHaveBeenLastCalledWith(
        expect.objectContaining({
            text: [
                "2024-10-04",
                "calibration-source-rwkv",
                "daily-prediction-standardizedGap-value: -1.491",
                "daily-prediction-actual: 80.0",
                "daily-prediction-predicted: 90.0",
                "daily-prediction-count: 20",
            ],
        })
    )
    expect(tooltipShown.set).toHaveBeenLastCalledWith(true)
    target.dispatchEvent(new MouseEvent("mouseleave"))
    expect(tooltipShown.set).toHaveBeenLastCalledWith(false)
    target.dispatchEvent(new FocusEvent("focus"))
    expect(tooltipShown.set).toHaveBeenLastCalledWith(true)
    target.dispatchEvent(new FocusEvent("blur"))
    expect(tooltipShown.set).toHaveBeenLastCalledWith(false)
})

test("undefined gaps stay available in tooltips without inventing a point at zero", () => {
    const svg = svgElement()
    renderDailyPredictionGraph(svg, [point(20000, null)], "standardizedGap")
    expect(svg.querySelectorAll(".daily-prediction-point")).toHaveLength(0)
    expect(svg.querySelector(".daily-prediction-hover")!.getAttribute("aria-label")).toContain(
        "daily-prediction-gap-unavailable"
    )
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
})

test("average surprise supports a single day, zero loss, redraws and empty searches", () => {
    const svg = svgElement()
    renderDailyPredictionGraph(svg, [{ ...point(20000), logLoss: 0 }], "logLoss")
    expect(svg.querySelectorAll(".daily-prediction-point")).toHaveLength(1)
    expect(svg.textContent).toContain("daily-prediction-logLoss-axis")
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
    renderDailyPredictionGraph(svg, [point(20000), point(20001)], "logLoss")
    expect(svg.querySelectorAll(".daily-prediction-series")).toHaveLength(1)
    expect(svg.querySelectorAll(".daily-prediction-point")).toHaveLength(2)
    renderDailyPredictionGraph(svg, [], "logLoss")
    expect(svg.children).toHaveLength(0)
})

test("both models share axes but retain their independent days, counts, and tooltips", () => {
    const svg = svgElement()
    render(
        svg,
        [
            { model: "fsrs", data: [point(20000, -5), { ...point(20001, 1), count: 10 }] },
            { model: "rwkv", data: [point(20001, -2), point(20002, 3)] },
        ],
        "standardizedGap"
    )
    expect(svg.querySelectorAll(".daily-prediction-series")).toHaveLength(2)
    expect(svg.querySelector('[data-model="fsrs"] path')!.getAttribute("stroke")).toBe("steelblue")
    expect(svg.querySelector('[data-model="rwkv"] path')!.getAttribute("stroke")).toBe("seagreen")
    const targets = [...svg.querySelectorAll(".daily-prediction-hover")]
    expect(targets).toHaveLength(3)
    expect(targets[0].getAttribute("aria-label")).not.toContain("calibration-source-rwkv")
    expect(targets[1].getAttribute("aria-label")).toContain("daily-prediction-count: 10")
    expect(targets[1].getAttribute("aria-label")).toContain("daily-prediction-count: 20")
    expect(targets[2].getAttribute("aria-label")).not.toContain("calibration-source-fsrs")
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
})

test.each(["standardizedGap", "logLoss"] as const)(
    "%s averages grey the daily values and restore model colors when disabled",
    (metric) => {
        const svg = svgElement()
        const data = [
            { ...point(20000, -2), logLoss: 0.2 },
            { ...point(20001, 2), logLoss: 0.8 },
            { ...point(20003, 4), logLoss: 1 },
        ]
        const series = [
            { model: "fsrs" as const, data },
            { model: "rwkv" as const, data },
        ]
        render(svg, series, metric, 2)
        expect(svg.querySelectorAll(".daily-prediction-average")).toHaveLength(2)
        for (const raw of svg.querySelectorAll(".daily-prediction-series")) {
            expect(raw.getAttribute("stroke")).toBe("#888")
            expect(raw.getAttribute("opacity")).toBe("0.35")
        }
        expect(
            svg
                .querySelector('[data-model="fsrs"] .daily-prediction-average')!
                .getAttribute("stroke")
        ).toBe("steelblue")
        const average = svg.querySelector('[data-model="rwkv"] .daily-prediction-average')!
        expect(average.getAttribute("stroke")).toBe("seagreen")
        expect(average.getAttribute("d")!.match(/M/g)).toHaveLength(2)
        const target = svg.querySelectorAll(".daily-prediction-hover")[1]
        expect(target.getAttribute("aria-label")).toContain(
            `daily-prediction-average-value: 2, ${metric === "logLoss" ? "0.500" : "0.000"}`
        )
        target.dispatchEvent(new FocusEvent("focus"))
        expect(tooltip.set).toHaveBeenLastCalledWith(
            expect.objectContaining({
                text: expect.arrayContaining([
                    `daily-prediction-average-value: 2, ${metric === "logLoss" ? "0.500" : "0.000"}`,
                ]),
            })
        )
        render(svg, series, metric)
        expect(svg.querySelectorAll(".daily-prediction-average")).toHaveLength(0)
        expect(svg.querySelector('[data-model="fsrs"] path')!.getAttribute("stroke")).toBe(
            "steelblue"
        )
        expect(svg.querySelector('[data-model="rwkv"] path')!.getAttribute("stroke")).toBe(
            "seagreen"
        )
    }
)

test("moving averages preserve undefined recall gaps and allow one model to be unavailable", () => {
    const svg = svgElement()
    render(
        svg,
        [
            { model: "fsrs", data: [] },
            { model: "rwkv", data: [point(20000, -1), point(20001, null), point(20002, 1)] },
        ],
        "standardizedGap",
        7
    )
    const average = svg.querySelector(".daily-prediction-average")!
    expect(average.getAttribute("d")!.match(/M/g)).toHaveLength(2)
    expect(svg.querySelectorAll(".daily-prediction-average-point")).toHaveLength(2)
    expect(svg.querySelectorAll(".daily-prediction-hover")[1].getAttribute("aria-label")).toContain(
        "daily-prediction-average-value: 7, daily-prediction-gap-unavailable"
    )
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
})

test("daily zoom crops both models and tooltips after averaging the full history", () => {
    const svg = svgElement()
    const data = [point(20000, 20), point(20001, 2), point(20002, 4), point(20004, 6)]
    const onZoom = jest.fn()
    const options = render(
        svg,
        [
            { model: "fsrs", data },
            { model: "rwkv", data },
        ],
        "standardizedGap",
        3,
        { start: 20002, end: 20004 },
        onZoom
    )!
    expect(svg.querySelectorAll(".daily-prediction-hover")).toHaveLength(2)
    expect(svg.querySelectorAll(".daily-prediction-point")).toHaveLength(4)
    expect(svg.querySelector(".daily-prediction-hover")?.getAttribute("aria-label")).toContain(
        "daily-prediction-average-value: 3, 8.667"
    )
    expect(
        svg.querySelector(".daily-prediction-average")?.getAttribute("d")!.match(/M/g)
    ).toHaveLength(2)
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
    options.onSelect(0, 0.33)
    expect(onZoom).toHaveBeenCalledWith({ start: 20002, end: 20002 })
    expect(data[0].standardizedGap).toBe(20)
    render(svg, [{ model: "fsrs", data }], "standardizedGap", 3, { start: 20003, end: 20003 })
    expect(svg.querySelectorAll(".daily-prediction-hover")).toHaveLength(0)
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
})
