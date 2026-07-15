/** @jest-environment jsdom */

jest.mock("../src/ts/i18n", () => ({
    i18n: (key: string) => key,
}))
jest.mock("../src/ts/stores", () => ({
    tooltip: { set: jest.fn() },
    tooltipShown: { set: jest.fn() },
}))

import { fsrsCalibrationGraph } from "../src/ts/FSRScalibration"

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
