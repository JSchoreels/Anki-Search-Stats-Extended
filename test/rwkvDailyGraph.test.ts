/** @jest-environment jsdom */

jest.mock("../src/ts/i18n", () => ({
    i18n: (key: string, args?: Record<string, string | number>) =>
        `${key}${args ? ": " + Object.values(args).join(", ") : ""}`,
}))
jest.mock("../src/ts/stores", () => ({
    tooltip: { set: jest.fn() },
    tooltipShown: { set: jest.fn() },
}))

import { renderRwkvDailyGraph, rwkvDailyTooltip } from "../src/ts/RwkvDailyGraph"
import type { RwkvDailyPoint } from "../src/ts/rwkvDailyData"
import { tooltip, tooltipShown } from "../src/ts/stores"

const point = (day: number, standardizedGap: number | null = 0): RwkvDailyPoint => ({
    day,
    count: 20,
    actualRecall: 0.8,
    predictedRecall: 0.9,
    standardizedGap,
    logLoss: 0.786,
})
const svgElement = () => document.createElementNS("http://www.w3.org/2000/svg", "svg")

test("rounding near-zero gaps does not display negative zero", () => {
    expect(rwkvDailyTooltip(point(20000, -1e-12), "standardizedGap")[1]).toBe(
        "rwkv-daily-standardizedGap-value: 0.000"
    )
})

test("recall gaps render on both sides of zero and do not join across missing days", () => {
    const svg = svgElement()
    renderRwkvDailyGraph(
        svg,
        [point(20000, -2), point(20001, 0), point(20003, 2)],
        "standardizedGap"
    )

    const zeroY = Number(svg.querySelector(".rwkv-daily-zero")!.getAttribute("y1"))
    const points = [...svg.querySelectorAll(".rwkv-daily-point")]
    expect(points).toHaveLength(3)
    expect(Number(points[0].getAttribute("cy"))).toBeGreaterThan(zeroY)
    expect(Number(points[1].getAttribute("cy"))).toBe(zeroY)
    expect(Number(points[2].getAttribute("cy"))).toBeLessThan(zeroY)
    expect(svg.querySelector(".rwkv-daily-series")!.getAttribute("d")!.match(/M/g)).toHaveLength(2)
    expect(svg.querySelectorAll(".rwkv-daily-hover")).toHaveLength(3)
    expect(svg.textContent).toContain("rwkv-daily-standardizedGap-axis")
})

test("tooltips expose metric, actual R, predicted R and count through hover and keyboard focus", () => {
    const svg = svgElement()
    renderRwkvDailyGraph(svg, [point(20000, -1.490712)], "standardizedGap")
    const target = svg.querySelector(".rwkv-daily-hover")!
    expect(target.getAttribute("tabindex")).toBe("0")
    target.dispatchEvent(new MouseEvent("mouseover", { clientX: 100, clientY: 100 }))
    expect(tooltip.set).toHaveBeenLastCalledWith(
        expect.objectContaining({
            text: [
                "2024-10-04",
                "rwkv-daily-standardizedGap-value: -1.491",
                "rwkv-daily-actual: 80.0",
                "rwkv-daily-predicted: 90.0",
                "rwkv-daily-count: 20",
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
    renderRwkvDailyGraph(svg, [point(20000, null)], "standardizedGap")
    expect(svg.querySelectorAll(".rwkv-daily-point")).toHaveLength(0)
    expect(svg.querySelector(".rwkv-daily-hover")!.getAttribute("aria-label")).toContain(
        "rwkv-daily-gap-unavailable"
    )
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
})

test("average surprise supports a single day, zero loss, redraws and empty searches", () => {
    const svg = svgElement()
    renderRwkvDailyGraph(svg, [{ ...point(20000), logLoss: 0 }], "logLoss")
    expect(svg.querySelectorAll(".rwkv-daily-point")).toHaveLength(1)
    expect(svg.textContent).toContain("rwkv-daily-logLoss-axis")
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
    renderRwkvDailyGraph(svg, [point(20000), point(20001)], "logLoss")
    expect(svg.querySelectorAll(".rwkv-daily-series")).toHaveLength(1)
    expect(svg.querySelectorAll(".rwkv-daily-point")).toHaveLength(2)
    renderRwkvDailyGraph(svg, [], "logLoss")
    expect(svg.children).toHaveLength(0)
})
