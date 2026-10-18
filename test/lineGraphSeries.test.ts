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
