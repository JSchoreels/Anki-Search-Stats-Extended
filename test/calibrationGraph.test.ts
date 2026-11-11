/** @jest-environment jsdom */

jest.mock("../src/ts/i18n", () => ({
    i18n: (key: string) => key,
}))
jest.mock("../src/ts/stores", () => ({
    tooltip: { set: jest.fn() },
    tooltipShown: { set: jest.fn() },
}))

import { fsrsCalibrationGraph } from "../src/ts/FSRScalibration"
import { tooltip } from "../src/ts/stores"

test("calibration graph fills its original SVG width and height", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")

    fsrsCalibrationGraph(svg, [{ real: 80, predicted: 75, count: 100 }])

    const viewBox = svg.getAttribute("viewBox")!.split(" ").map(Number)
    expect(viewBox[3]).toBe(375)
    expect(svg.querySelector(".calibration-x-axis")?.getAttribute("transform")).toBe(
        "translate(0, 325)"
    )
    expect(svg.querySelector(".calibration-y-axis")?.getAttribute("transform")).toBeNull()
    expect(svg.querySelector(".calibration-volume-axis")?.getAttribute("transform")).toBe(
        "translate(600, 0)"
    )
    expect(svg.querySelector(".grid-lines-x line")?.getAttribute("y2")).toBe("325")
    expect(svg.querySelector(".grid-lines-y line")?.getAttribute("x1")).toBe("0")
    expect(svg.querySelector(".grid-lines-y line")?.getAttribute("x2")).toBe("600")
})

test("calibration graph renders two arbitrary model labels and their confidence intervals", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    fsrsCalibrationGraph(svg, [
        {
            label: "RWKV Big",
            color: "steelblue",
            bins: [{ real: 4, predicted: 3.5, count: 5, confidenceInterval: [0.5, 1] }],
        },
        {
            label: "RWKV Small Curve",
            color: "seagreen",
            bins: [{ real: 3, predicted: 3.2, count: 4, confidenceInterval: [0.4, 1] }],
        },
    ])

    expect(svg.querySelectorAll("path.calibration-series")).toHaveLength(2)
    expect(svg.querySelectorAll(".calibration-confidence-intervals > g")).toHaveLength(2)
    expect(svg.textContent).toContain("RWKV Big")
    expect(svg.textContent).toContain("RWKV Small Curve")
    svg.querySelector(".hover-bar")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    expect(tooltip.set).toHaveBeenLastCalledWith(
        expect.objectContaining({
            text: expect.arrayContaining([
                "RWKV Big: 70.0% predicted",
                "RWKV Small Curve: 80.0% predicted",
                "actual: 80.0%, count: 5",
                "actual: 75.0%, count: 4",
            ]),
        })
    )
})
