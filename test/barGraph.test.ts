/** @jest-environment jsdom */

jest.mock("../src/ts/i18n", () => ({ i18n_bundle: { formatPattern: jest.fn() } }))
jest.mock("../src/ts/stores", () => ({
    tooltip: { set: jest.fn() },
    tooltipShown: { set: jest.fn() },
}))

import { renderBarChart, type BarChart } from "../src/ts/bar"
import { tooltip } from "../src/ts/stores"

function chart(): BarChart {
    return {
        row_labels: ["Again", "Good", "Easy"],
        row_colours: ["red", "green", "blue"],
        data: [{ label: "0", values: [2, 6, 2] }],
        hidden_rows: new Set([0]),
        normalise: true,
        extraStats: () => [],
    }
}

test("Bars normalise visible rows and expose the displayed data to trend and average overlays", () => {
    const data = chart()
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    const onClick = jest.fn()
    data.data[0].onClick = onClick
    const result = renderBarChart(data, svg)
    expect(result.chart.data[0].values).toEqual([0, 0.75, 0.25])
    expect(data.data[0].values).toEqual([2, 6, 2])
    expect(result.maxValue).toBe(1)

    const hover = svg.querySelector(".hover-bar")!
    hover.dispatchEvent(new MouseEvent("mouseover"))
    expect(tooltip.set).toHaveBeenCalledWith(
        expect.objectContaining({
            text: ['"0"', "Good: 75%", "Easy: 25%"],
        })
    )
    hover.dispatchEvent(new MouseEvent("click"))
    expect(onClick).toHaveBeenCalledTimes(1)
})

test("Reversed legends hide the matching source row", () => {
    const data = { ...chart(), reverse_legend: true }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    expect(renderBarChart(data, svg).chart.data[0].values).toEqual([0.25, 0.75, 0])
    svg.querySelector(".hover-bar")!.dispatchEvent(new MouseEvent("mouseover"))
    expect(tooltip.set).toHaveBeenCalledWith(
        expect.objectContaining({
            text: ['"0"', "Again: 25%", "Good: 75%"],
        })
    )
})

test("Tooltip summaries retain row indices after hiding a rating", () => {
    const data = chart()
    data.extraStats = (datum) => [`Easy: ${datum.values[2] * 100}%`]
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    renderBarChart(data, svg)
    svg.querySelector(".hover-bar")!.dispatchEvent(new MouseEvent("mouseover"))
    expect(tooltip.set).toHaveBeenCalledWith(
        expect.objectContaining({
            text: ['"0"', "Good: 75%", "Easy: 25%", "Easy: 25%"],
        })
    )
})

test("Empty and fully hidden percentage bars stay finite", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    for (const data of [
        { ...chart(), data: [{ label: "0", values: [0, 0, 0] }] },
        { ...chart(), hidden_rows: new Set([0, 1, 2]) },
    ]) {
        expect(renderBarChart(data, svg).chart.data[0].values).toEqual([0, 0, 0])
        expect(svg.outerHTML).not.toMatch(/NaN|Infinity/)
    }
})
