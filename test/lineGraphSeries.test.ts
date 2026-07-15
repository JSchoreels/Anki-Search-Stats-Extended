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
