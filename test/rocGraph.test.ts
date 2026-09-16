/** @jest-environment jsdom */

jest.mock("../src/ts/i18n", () => ({
    i18n: (key: string, args?: Record<string, string>) => {
        if (key === "calibration-source-fsrs") return "FSRS"
        if (key === "calibration-source-rwkv") return "RWKV"
        if (key === "roc-legend") return `${args?.model}, AUC=${args?.auc}`
        if (key === "roc-chance-legend") return "Chance, AUC=0.5000"
        return key
    },
}))
jest.mock("../src/ts/stores", () => ({
    tooltip: { set: jest.fn() },
    tooltipShown: { set: jest.fn() },
}))

import { renderRocGraph } from "../src/ts/ROCGraph"

test("ROC graph renders both model curves, chance baseline, axes, and AUC", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")

    renderRocGraph(svg, {
        fsrs: {
            points: [
                { falsePositiveRate: 0, truePositiveRate: 0, threshold: Infinity },
                { falsePositiveRate: 0, truePositiveRate: 1, threshold: 0.8 },
                { falsePositiveRate: 1, truePositiveRate: 1, threshold: 0.2 },
            ],
            auc: 1,
        },
        rwkv: {
            points: [
                { falsePositiveRate: 0, truePositiveRate: 0, threshold: Infinity },
                { falsePositiveRate: 1, truePositiveRate: 0, threshold: 0.8 },
                { falsePositiveRate: 1, truePositiveRate: 1, threshold: 0.2 },
            ],
            auc: 0,
        },
        count: 2,
        positiveCount: 1,
        negativeCount: 1,
    })

    const curves = [...svg.querySelectorAll<SVGPathElement>("path.roc-series")]
    expect(curves).toHaveLength(2)
    expect(curves[0].getAttribute("stroke")).toBe("steelblue")
    expect(curves[1].getAttribute("stroke")).toBe("seagreen")
    expect(svg.querySelector("line.roc-chance-line")?.getAttribute("stroke")).toBe("orange")
    expect(svg.textContent).toContain("FSRS, AUC=1.0000")
    expect(svg.textContent).toContain("RWKV, AUC=0.0000")
    expect(svg.textContent).toContain("Chance, AUC=0.5000")
    expect(svg.textContent).toContain("roc-x-axis")
    expect(svg.textContent).toContain("roc-y-axis")
    expect(svg.querySelectorAll(".roc-thresholds circle")).toHaveLength(4)

    const viewBox = svg.getAttribute("viewBox")!.split(" ").map(Number)
    expect(viewBox).toEqual([-50, -10, 665, 385])
    expect(svg.querySelector(".roc-x-axis")?.getAttribute("transform")).toBe("translate(0, 325)")
    expect(svg.querySelector(".grid-lines-x line")?.getAttribute("y2")).toBe("325")
    expect(svg.querySelector(".grid-lines-y line")?.getAttribute("x2")).toBe("600")
})
