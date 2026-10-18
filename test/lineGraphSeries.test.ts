/** @jest-environment jsdom */

import { renderLineChart } from "../src/ts/LineGraph"

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
