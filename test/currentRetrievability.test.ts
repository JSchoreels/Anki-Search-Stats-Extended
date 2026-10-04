/** @jest-environment jsdom */
jest.mock("../src/ts/i18n", () => ({
    i18n: (key: string, args?: Record<string, unknown>) => `${key} ${JSON.stringify(args ?? {})}`,
}))
jest.mock("../src/ts/search", () => ({ browseCurrentDisagreementCards: jest.fn() }))

import { buildCurrentRetrievabilityBins } from "../src/ts/currentRetrievabilityData"
import { renderCurrentRetrievabilityGraph } from "../src/ts/CurrentRetrievabilityGraph"
import { browseCurrentDisagreementCards } from "../src/ts/search"

test("same-bucket agreement counts once; disagreement retains each model's exact membership", () => {
    const bins = buildCurrentRetrievabilityBins([
        { cid: 1, fsrs: 0.71, rwkv: 0.74 },
        { cid: 2, fsrs: 0.72, rwkv: 0.91 },
        { cid: 3, fsrs: 0.92, rwkv: 0.73 },
        { cid: 4, fsrs: 0.71, rwkv: 0.72 },
    ])
    expect(bins[14]).toMatchObject({ both: [1, 4], rwkv: [3], fsrs: [2] })
    expect(bins[18]).toMatchObject({ both: [], rwkv: [2], fsrs: [3] })
    expect(bins.reduce((sum, bin) => sum + bin.both.length + bin.rwkv.length, 0)).toBe(4)
    expect(bins.reduce((sum, bin) => sum + bin.both.length + bin.fsrs.length, 0)).toBe(4)
    expect(bins.flatMap((bin) => bin.both)).toEqual([1, 4])
    expect(bins.flatMap((bin) => bin.rwkv)).toHaveLength(2)
    expect(bins.flatMap((bin) => bin.fsrs)).toHaveLength(2)
})

test("fixed 5-point intervals include their lower boundary and include 100% in the last bin", () => {
    const bins = buildCurrentRetrievabilityBins([
        { cid: 1, fsrs: 0, rwkv: 0.049999 },
        { cid: 2, fsrs: 0.05, rwkv: 0.099999 },
        { cid: 3, fsrs: 0.1, rwkv: 0.149999 },
        { cid: 4, fsrs: 0.95, rwkv: 1 },
        { cid: 5, fsrs: 0.949999, rwkv: 0.95 },
    ])
    expect(bins).toHaveLength(20)
    expect(bins[0]).toMatchObject({ lower: 0, upper: 0.05, both: [1] })
    expect(bins[1]).toMatchObject({ lower: 0.05, upper: 0.1, both: [2] })
    expect(bins[2]).toMatchObject({ lower: 0.1, upper: 0.15, both: [3] })
    expect(bins[18].fsrs).toEqual([5])
    expect(bins[19]).toMatchObject({ lower: 0.95, upper: 1, both: [4], rwkv: [5] })
})

test("invalid pairs and duplicate cards do not inflate agreement or disagreement counts", () => {
    const bins = buildCurrentRetrievabilityBins([
        { cid: 1, fsrs: NaN, rwkv: 0.5 },
        { cid: 1, fsrs: 0.5, rwkv: 0.5 },
        { cid: 1, fsrs: 0.5, rwkv: 0.9 },
        { cid: 2, fsrs: 0.8, rwkv: undefined as unknown as number },
        { cid: 3, fsrs: -0.01, rwkv: 0.8 },
        { cid: 4, fsrs: 0.8, rwkv: 1.01 },
        { cid: 5, fsrs: Infinity, rwkv: 0.8 },
        { cid: 0, fsrs: 0.8, rwkv: 0.8 },
        { cid: 1.5, fsrs: 0.8, rwkv: 0.8 },
        { cid: Number.MAX_SAFE_INTEGER + 1, fsrs: 0.8, rwkv: 0.8 },
    ])
    expect(bins.flatMap((bin) => bin.both)).toEqual([1])
    expect(bins.flatMap((bin) => [...bin.rwkv, ...bin.fsrs])).toEqual([])
})

test("grey, green and blue segments stack with accurate heights and browse only their members", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    renderCurrentRetrievabilityGraph(
        svg,
        buildCurrentRetrievabilityBins([
            { cid: 1, fsrs: 0.71, rwkv: 0.74 },
            { cid: 2, fsrs: 0.72, rwkv: 0.91 },
            { cid: 3, fsrs: 0.92, rwkv: 0.73 },
            { cid: 4, fsrs: 0.71, rwkv: 0.72 },
        ])
    )
    const bars = [...svg.querySelectorAll<SVGRectElement>(".current-retrievability-bar")]
    expect(bars).toHaveLength(5)
    expect(bars.slice(0, 3).map((bar) => bar.getAttribute("fill"))).toEqual([
        "grey",
        "seagreen",
        "steelblue",
    ])
    const height = (bar: SVGRectElement) => Number(bar.getAttribute("height"))
    const top = (bar: SVGRectElement) => Number(bar.getAttribute("y"))
    expect(height(bars[0])).toBeCloseTo(2 * height(bars[1]))
    expect(height(bars[1])).toBeCloseTo(height(bars[2]))
    expect(top(bars[0])).toBeCloseTo(top(bars[1]) + height(bars[1]))
    expect(top(bars[1])).toBeCloseTo(top(bars[2]) + height(bars[2]))
    expect(new Set(bars.slice(0, 3).map((bar) => bar.getAttribute("x"))).size).toBe(1)
    bars[0].dispatchEvent(new MouseEvent("click"))
    expect(browseCurrentDisagreementCards).toHaveBeenLastCalledWith([1, 4])
    bars[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
    expect(browseCurrentDisagreementCards).toHaveBeenLastCalledWith([3])
    bars[2].dispatchEvent(new KeyboardEvent("keydown", { key: " " }))
    expect(browseCurrentDisagreementCards).toHaveBeenLastCalledWith([2])
    bars[3].dispatchEvent(new MouseEvent("click"))
    expect(browseCurrentDisagreementCards).toHaveBeenLastCalledWith([2])
    expect(bars[0].getAttribute("role")).toBe("button")
    expect(bars[0].getAttribute("tabindex")).toBe("0")
    expect(bars[0].getAttribute("aria-label")).toContain('"lower":"70%"')
    expect(bars[0].querySelector("title")?.textContent).toContain('"count":2')
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
})

test("single cards and endpoint bars render; redraw clears old data and empty searches", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    renderCurrentRetrievabilityGraph(
        svg,
        buildCurrentRetrievabilityBins([{ cid: 1, fsrs: 0, rwkv: 1 }])
    )
    const bars = [...svg.querySelectorAll(".current-retrievability-bar")]
    expect(bars).toHaveLength(2)
    expect(bars.map((bar) => bar.getAttribute("fill"))).toEqual(["steelblue", "seagreen"])
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
    renderCurrentRetrievabilityGraph(
        svg,
        buildCurrentRetrievabilityBins([{ cid: 2, fsrs: 1, rwkv: 1 }])
    )
    expect(svg.querySelectorAll(".current-retrievability-bar")).toHaveLength(1)
    expect(svg.querySelector(".current-retrievability-both")?.getAttribute("fill")).toBe("grey")
    renderCurrentRetrievabilityGraph(svg, buildCurrentRetrievabilityBins([]))
    expect(svg.children).toHaveLength(0)
})
