/** @jest-environment jsdom */

jest.mock("../src/ts/i18n", () => ({
    i18n: (key: string, args?: Record<string, string>) => {
        if (key === "calibration-source-fsrs") return "FSRS"
        if (key === "calibration-source-rwkv") return "RWKV"
        if (key === "um-plus-legend")
            return `${args?.model}, UM+=${args?.score}, slope=${args?.slope}`
        if (key === "um-plus-x-axis") return `${key}: ${args?.first} minus ${args?.second}`
        if (key === "um-plus-tooltip-disagreement")
            return `${args?.first} − ${args?.second}: ${args?.value}`
        if (key === "um-plus-slope-unavailable") return "n/a"
        return key
    },
}))
jest.mock("../src/ts/stores", () => ({
    tooltip: { set: jest.fn() },
    tooltipShown: { set: jest.fn() },
}))

import { renderUmPlusGraph } from "../src/ts/UMPlusGraph"
import { tooltip } from "../src/ts/stores"

test("UM+ graph renders paired model curves, volume bars, bubbles, and scores", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")

    renderUmPlusGraph(svg, {
        bins: [
            { index: 16, disagreement: -0.2, firstError: 0, secondError: 0.2, count: 200 },
            { index: 24, disagreement: 0.2, firstError: 0, secondError: -0.2, count: 400 },
        ],
        firstScore: 0,
        secondScore: 0.2,
        count: 600,
    })

    expect(svg.querySelectorAll("line.um-plus-series-segment")).toHaveLength(2)
    const volumeBars = [...svg.querySelectorAll<SVGRectElement>("rect.um-plus-volume-bar")]
    expect(volumeBars).toHaveLength(2)
    expect(Number(volumeBars[1].getAttribute("height"))).toBeGreaterThan(
        Number(volumeBars[0].getAttribute("height"))
    )
    const bubbles = [...svg.querySelectorAll("circle")]
    expect(bubbles).toHaveLength(4)
    expect(bubbles[0].getAttribute("r")).toBe(bubbles[2].getAttribute("r"))
    expect(bubbles[1].getAttribute("r")).toBe(bubbles[3].getAttribute("r"))
    expect(Number(bubbles[1].getAttribute("r"))).toBeGreaterThan(
        Number(bubbles[0].getAttribute("r"))
    )
    expect(svg.textContent).toContain("FSRS, UM+=0.0000, slope=0.000")
    expect(svg.textContent).toContain("RWKV, UM+=0.2000, slope=-1.000")
    expect(svg.textContent).toContain("um-plus-x-axis")
    expect(svg.textContent).toContain("um-plus-y-axis")
    expect(svg.textContent).toContain("um-plus-volume-axis")
    const viewBox = svg.getAttribute("viewBox")!.split(" ").map(Number)
    expect(viewBox).toEqual([-50, -10, 715, 385])
    expect(svg.querySelector(".um-plus-x-axis")?.getAttribute("transform")).toBe(
        "translate(0, 325)"
    )
    expect(svg.querySelector(".um-plus-y-axis")?.getAttribute("transform")).toBeNull()
    expect(svg.querySelector(".um-plus-volume-axis")?.getAttribute("transform")).toBe(
        "translate(600, 0)"
    )
    expect(svg.querySelector(".grid-lines-x line")?.getAttribute("y2")).toBe("325")
    expect(svg.querySelector(".grid-lines-y line")?.getAttribute("x1")).toBe("0")
    expect(svg.querySelector(".grid-lines-y line")?.getAttribute("x2")).toBe("600")
})

test("UM+ labels the selected models and disagreement direction throughout the graph", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    renderUmPlusGraph(
        svg,
        {
            bins: [{ index: 24, disagreement: 0.2, firstError: 0, secondError: -0.2, count: 200 }],
            firstScore: 0,
            secondScore: 0.2,
            count: 200,
            disagreementPercentiles: [],
        },
        { firstModel: "RWKV Big", secondModel: "RWKV Small" }
    )
    expect(svg.textContent).toContain("RWKV Big, UM+=0.0000")
    expect(svg.textContent).toContain("RWKV Small, UM+=0.2000")
    expect(svg.textContent).toContain("RWKV Big minus RWKV Small")
    const hover = [...svg.querySelectorAll("rect")].find(
        (element) => element.getAttribute("fill") === "transparent"
    )!
    hover.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    expect(tooltip.set).toHaveBeenLastCalledWith(
        expect.objectContaining({
            text: expect.arrayContaining(["RWKV Big − RWKV Small: +20.0%"]),
        })
    )
})

test("UM+ graph only reveals small buckets as faint dotted data when requested", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    const data = {
        bins: [
            { index: 16, disagreement: -0.2, firstError: 0, secondError: 0.2, count: 100 },
            { index: 20, disagreement: 0, firstError: 0, secondError: 0, count: 300 },
            { index: 24, disagreement: 0.2, firstError: 0, secondError: -0.2, count: 100 },
        ],
        firstScore: 0,
        secondScore: 0.2,
        count: 500,
    }

    renderUmPlusGraph(svg, data)
    expect(svg.querySelectorAll("rect.um-plus-volume-bar")).toHaveLength(1)
    expect(svg.querySelectorAll("circle.um-plus-point")).toHaveLength(2)
    expect(svg.querySelectorAll(".um-plus-small-bucket")).toHaveLength(0)

    renderUmPlusGraph(svg, data, { showSmallBuckets: true })
    expect(svg.querySelectorAll("rect.um-plus-volume-bar")).toHaveLength(3)
    expect(svg.querySelectorAll("circle.um-plus-point")).toHaveLength(6)
    const smallSegments = [
        ...svg.querySelectorAll<SVGLineElement>("line.um-plus-series-segment.um-plus-small-bucket"),
    ]
    expect(smallSegments).toHaveLength(4)
    expect(
        smallSegments.every((segment) => segment.getAttribute("stroke-dasharray") === "3 3")
    ).toBe(true)
    expect(smallSegments.every((segment) => segment.getAttribute("opacity") === "0.35")).toBe(true)
})

test("UM+ graph uses 10 percentage-point ticks on both axes", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")

    renderUmPlusGraph(svg, {
        bins: [
            { index: 16, disagreement: -0.2, firstError: 0, secondError: 0.2, count: 200 },
            { index: 24, disagreement: 0.2, firstError: 0, secondError: -0.2, count: 200 },
        ],
        firstScore: 0,
        secondScore: 0.2,
        count: 400,
    })

    const xTicks = [...svg.querySelectorAll(".um-plus-x-axis .tick text")].map(
        (tick) => tick.textContent
    )
    const yTicks = [...svg.querySelectorAll(".um-plus-y-axis .tick text")].map(
        (tick) => tick.textContent
    )
    expect(xTicks).toEqual(["-20%", "-10%", "0%", "+10%", "+20%"])
    expect(yTicks).toEqual(["-20%", "-10%", "0%", "+10%", "+20%"])
})

test("UM+ y-axis covers only currently visible bucket errors", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    const data = {
        bins: [
            { index: 16, disagreement: -0.2, firstError: -0.7, secondError: -0.5, count: 100 },
            { index: 20, disagreement: 0, firstError: 0.04, secondError: 0.16, count: 300 },
        ],
        firstScore: 0.1,
        secondScore: 0.2,
        count: 400,
    }

    renderUmPlusGraph(svg, data)
    expect(
        [...svg.querySelectorAll(".um-plus-y-axis .tick text")].map((tick) => tick.textContent)
    ).toEqual(["-10%", "0%", "+10%", "+20%"])

    renderUmPlusGraph(svg, data, { showSmallBuckets: true })
    expect(
        [...svg.querySelectorAll(".um-plus-y-axis .tick text")].map((tick) => tick.textContent)
    ).toEqual(["-70%", "-60%", "-50%", "-40%", "-30%", "-20%", "-10%", "0%", "+10%", "+20%"])
})
