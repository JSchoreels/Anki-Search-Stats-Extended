/** @jest-environment jsdom */

import { get } from "svelte/store"
import { lineChartPercentileCeiling, renderLineChart } from "../src/ts/LineGraph"
import { tooltip } from "../src/ts/stores"

test("renderLineChart overlays progressive named series", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")

    renderLineChart(svg, [], "Cards", {
        series: [
            { label: "FSRS", data: [1, 2, 3], color: "steelblue" },
            { label: "RWKV", data: [1, 1.5], color: "seagreen" },
        ],
    })

    const paths = [...svg.querySelectorAll<SVGPathElement>("path.line-series")]
    expect(paths).toHaveLength(2)
    expect(paths.map((path) => path.getAttribute("stroke"))).toEqual(["steelblue", "seagreen"])
    expect(svg.textContent).toContain("FSRS")
    expect(svg.textContent).toContain("RWKV")
})

test("the legend shows the same dashed style as a comparison line", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    renderLineChart(svg, [], "Recall", {
        series: [
            { label: "With review", data: [80, 90], color: "steelblue" },
            { label: "Without review", data: [60, 70], color: "steelblue", strokeDasharray: "5 3" },
        ],
    })
    const lines = svg.querySelectorAll(".line-legend line")
    expect(lines[0].getAttribute("stroke-dasharray")).toBeNull()
    expect(lines[1].getAttribute("stroke-dasharray")).toBe("5 3")
})

test("renderLineChart draws faint daily underlays behind averaged series", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")

    renderLineChart(svg, [], "Cards", {
        series: [
            { label: "RWKV (7-day average)", data: [1, 2, 3], color: "seagreen" },
            {
                label: "RWKV (daily)",
                data: [1, 3, 2],
                color: "#888",
                opacity: 0.35,
                strokeDasharray: "3 3",
                renderOrder: -1,
                legend: false,
            },
        ],
    })

    const paths = [...svg.querySelectorAll<SVGPathElement>("path.line-series")]
    expect(paths.map((path) => path.getAttribute("stroke"))).toEqual(["#888", "seagreen"])
    expect(paths[0].getAttribute("stroke-dasharray")).toBe("3 3")
    expect(paths[0].getAttribute("opacity")).toBe("0.35")
    expect(svg.textContent).not.toContain("RWKV (daily)")
})

test("display-only daily outliers do not flatten averaged lines", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    const formatY = (value: number) => value.toLocaleString("en-GB")

    renderLineChart(svg, [], "Rate", {
        bounds: { width: 270, height: 150 },
        formatY,
        includeNegative: true,
        series: [
            { label: "FSRS (7-day average)", data: [-100, 200], color: "steelblue" },
            {
                label: "FSRS (daily)",
                data: [50_000, -5_000],
                color: "#888",
                legend: false,
                includeInYAxis: false,
            },
        ],
    })

    expect(svg.textContent).not.toContain("50,000")
    expect(svg.querySelector(".line-plot")?.getAttribute("clip-path")).toMatch(
        /^url\(#sse-line-clip-/
    )
    const zeroY = Number(svg.querySelector(".line-zero")?.getAttribute("y1"))
    expect(zeroY).toBeGreaterThan(0)
    expect(zeroY).toBeLessThan(150)
    svg.querySelectorAll(".hover-bar")[0].dispatchEvent(new MouseEvent("mouseover"))
    expect(get(tooltip).text).toContain("FSRS (daily): 50,000")
})

test("bounded daily ratio charts preserve gaps and show isolated values with percentage axes", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    const values = [999, NaN, 200, NaN]
    renderLineChart(svg, values, "Maturing / new", {
        dayRange: { start: 1, end: 3 },
        bounds: { width: 270, height: 150 },
        formatY: (value) => `${value}%`,
        showIsolatedPoints: true,
    })
    expect(svg.getAttribute("viewBox")).toBe("-40 -10 320 200")
    expect(svg.querySelectorAll(".line-isolated-point")).toHaveLength(1)
    expect(svg.querySelectorAll(".hover-bar")).toHaveLength(3)
    expect(svg.textContent).toContain("200%")
    expect(svg.querySelector("path.line-series")?.getAttribute("d")).not.toContain("NaN")
})

test("signed line charts place a zero reference between positive and negative values", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    renderLineChart(svg, [Number.NaN, Number.NaN, -5, 10], "Rate", {
        bounds: { width: 270, height: 150 },
        formatY: (value) => value.toString(),
        includeNegative: true,
    })

    const zero = svg.querySelector<SVGLineElement>(".line-zero")
    const zeroY = Number(zero?.getAttribute("y1"))
    expect(zero).not.toBeNull()
    expect(zeroY).toBeGreaterThan(0)
    expect(zeroY).toBeLessThan(150)
    expect(svg.querySelector("path.line-series")?.getAttribute("d")).not.toMatch(/NaN|Infinity/)
    expect(svg.querySelectorAll(".hover-bar")).toHaveLength(2)
    svg.querySelectorAll(".hover-bar")[0].dispatchEvent(new MouseEvent("mouseover"))
    expect(get(tooltip).text).toContain("Rate: -5")
})

test("percentile ceiling uses daily maxima across series and ignores unavailable days", () => {
    const named = (data: number[]) => ({ label: "Cards", color: "steelblue", data })
    expect(
        lineChartPercentileCeiling(
            [
                named([100, 100, 100, 100, 100, 0, 0, 0, 0, 0]),
                named([0, 0, 0, 0, 0, 100, 100, 100, 100, 100]),
            ],
            0,
            9,
            50
        )
    ).toBe(100)
    expect(lineChartPercentileCeiling([named([NaN, NaN, 10, 20])], 0, 3, 50)).toBe(15)
    expect(lineChartPercentileCeiling([named([1000, 1, 2])], 1, 2, 90)).toBeCloseTo(1.9)
    expect(lineChartPercentileCeiling([named([0, 0, NaN])], 0, 2, 90)).toBe(1)
})

test("P90 clips peaks without changing tooltip values and P100 restores the full range", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 1000]
    const options = { dayRange: { start: 0, end: 10 }, bounds: { width: 300, height: 250 } }
    renderLineChart(svg, values, "Cards", { ...options, yPercentile: 90 })
    expect(svg.querySelector(".line-plot")?.getAttribute("clip-path")).toMatch(
        /^url\(#sse-line-clip-/
    )
    expect(svg.querySelector("clipPath rect")?.getAttribute("height")).toBe("250")
    expect(svg.textContent).not.toContain("1,000")
    svg.querySelectorAll(".hover-bar")[10].dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true })
    )
    expect(get(tooltip).text).toContain("Cards: 1000")
    expect(values[10]).toBe(1000)
    renderLineChart(svg, values, "Cards", { ...options, yPercentile: 100 })
    expect(svg.querySelector(".line-plot")?.hasAttribute("clip-path")).toBe(false)
    expect(svg.textContent).toContain("1,000")
})

test("line zoom rescales visible values, bounds the date range and retains source totals", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    const values = [1000, 10, 20, 30, 5000]
    const onZoom = jest.fn()
    const options = renderLineChart(svg, values, "Memorised", {
        zoomRange: { start: 1, end: 3 },
        onZoom,
    })!
    expect(svg.querySelectorAll(".hover-bar")).toHaveLength(3)
    expect(svg.textContent).not.toContain("1,000")
    expect(svg.querySelector("path.line-series")?.getAttribute("d")).not.toMatch(/NaN|Infinity/)
    svg.querySelectorAll(".hover-bar")[1].dispatchEvent(new MouseEvent("mouseover"))
    expect(get(tooltip).text).toContain("Memorised: 20")
    options.onSelect(0, 0.5)
    expect(onZoom).toHaveBeenLastCalledWith({ start: 1, end: 2 })
    expect(values).toEqual([1000, 10, 20, 30, 5000])
    renderLineChart(svg, values, "Memorised", {
        dayRange: { start: 2, end: 3 },
        zoomRange: { start: 0, end: 4 },
    })
    expect(svg.querySelectorAll(".hover-bar")).toHaveLength(2)
    renderLineChart(svg, values, "Memorised", { zoomRange: { start: 2, end: 2 } })
    expect(svg.querySelectorAll(".line-isolated-point")).toHaveLength(1)
})
