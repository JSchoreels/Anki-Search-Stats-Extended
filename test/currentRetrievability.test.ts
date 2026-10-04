/** @jest-environment jsdom */
jest.mock("../src/ts/i18n", () => ({
    i18n: (key: string, args?: Record<string, unknown>) => `${key} ${JSON.stringify(args ?? {})}`,
}))
jest.mock("../src/ts/search", () => ({ browseCurrentDisagreementCards: jest.fn() }))

import { hsl } from "d3"
import { buildCurrentRetrievabilityBins } from "../src/ts/currentRetrievabilityData"
import {
    currentRetrievabilityShiftColor,
    renderCurrentRetrievabilityGraph,
} from "../src/ts/CurrentRetrievabilityGraph"
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

test("shift groups use signed bucket differences and retain exact shifts beyond five", () => {
    const bins = buildCurrentRetrievabilityBins([
        { cid: 1, fsrs: 0.049, rwkv: 0.05 },
        { cid: 2, fsrs: 0.05, rwkv: 0.049 },
        { cid: 3, fsrs: 0.25, rwkv: 0.5 },
        { cid: 4, fsrs: 0.5, rwkv: 0.25 },
        { cid: 5, fsrs: 0, rwkv: 1 },
        { cid: 6, fsrs: 1, rwkv: 0 },
        { cid: 7, fsrs: 0.951, rwkv: 1 },
        { cid: 5, fsrs: 0.5, rwkv: 0.75 },
        { cid: 8, fsrs: -0.1, rwkv: 0.75 },
    ])
    expect(bins[0].shifts).toEqual({ rwkv: { [-1]: [2], [-19]: [6] }, fsrs: { 1: [1], 19: [5] } })
    expect(bins[1].shifts).toEqual({ rwkv: { 1: [1] }, fsrs: { [-1]: [2] } })
    expect(bins[5].shifts).toEqual({ rwkv: { [-5]: [4] }, fsrs: { 5: [3] } })
    expect(bins[10].shifts).toEqual({ rwkv: { 5: [3] }, fsrs: { [-5]: [4] } })
    expect(bins[19].shifts).toEqual({ rwkv: { 19: [5] }, fsrs: { [-19]: [6] } })
    expect(bins[19].both).toEqual([7])
})

test("up and down shifts gain saturation through five levels and then keep the strongest shade", () => {
    expect(currentRetrievabilityShiftColor(0)).toBe("grey")
    for (const sign of [-1, 1]) {
        const shades = [1, 2, 3, 4, 5].map((level) => currentRetrievabilityShiftColor(sign * level))
        expect(new Set(shades).size).toBe(5)
        shades.slice(1).forEach((shade, index) => {
            expect(hsl(shade).s).toBeGreaterThan(hsl(shades[index]).s)
            expect(hsl(shade).l).toBeLessThan(hsl(shades[index]).l)
        })
        expect(currentRetrievabilityShiftColor(sign * 6)).toBe(shades[4])
        expect(currentRetrievabilityShiftColor(sign * 19)).toBe(shades[4])
    }
    const green = hsl(currentRetrievabilityShiftColor(5))
    const red = hsl(currentRetrievabilityShiftColor(-5))
    expect(green.h).toBeCloseTo(135, 0)
    expect(red.h).toBe(0)
})

test("shift coloring preserves bar totals and browses exact shift and model groups at both endpoints", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    const bins = buildCurrentRetrievabilityBins([
        { cid: 1, fsrs: 0.51, rwkv: 0.53 },
        { cid: 2, fsrs: 0.26, rwkv: 0.51 },
        { cid: 3, fsrs: 0.46, rwkv: 0.51 },
        { cid: 4, fsrs: 0.76, rwkv: 0.51 },
        { cid: 5, fsrs: 0.56, rwkv: 0.51 },
        { cid: 6, fsrs: 0.51, rwkv: 0.99 },
        { cid: 7, fsrs: 0, rwkv: 1 },
        { cid: 8, fsrs: 1, rwkv: 0 },
    ])
    const bars = () => [...svg.querySelectorAll<SVGRectElement>(".current-retrievability-bar")]
    const columnHeights = () => {
        const heights: Record<string, number> = {}
        for (const bar of bars()) {
            const x = bar.getAttribute("x")!
            heights[x] = (heights[x] ?? 0) + Number(bar.getAttribute("height"))
        }
        return heights
    }
    renderCurrentRetrievabilityGraph(svg, bins)
    const originalHeights = columnHeights()
    renderCurrentRetrievabilityGraph(svg, bins, { colorByBucketShift: true })
    expect(bars()).toHaveLength(15)
    for (const [x, height] of Object.entries(columnHeights())) {
        expect(height).toBeCloseTo(originalHeights[x])
    }
    for (const shift of [-19, -5, -1, 1, 5, 9, 19]) {
        const endpoints = svg.querySelectorAll<SVGRectElement>(`[data-bucket-shift="${shift}"]`)
        expect(endpoints).toHaveLength(2)
        expect(endpoints[0].getAttribute("fill")).toBe(currentRetrievabilityShiftColor(shift))
        expect(endpoints[1].getAttribute("fill")).toBe(endpoints[0].getAttribute("fill"))
    }
    const higher = svg.querySelector<SVGRectElement>(
        '.current-retrievability-rwkv[data-bucket-shift="5"]'
    )!
    higher.dispatchEvent(new MouseEvent("click"))
    expect(browseCurrentDisagreementCards).toHaveBeenLastCalledWith([2])
    expect(higher.querySelector("title")?.textContent).toContain('"shift":"+5"')
    expect(higher.getAttribute("aria-label")).toContain("current-retrievability-rwkv")
    const extreme = svg.querySelector<SVGRectElement>(
        '.current-retrievability-fsrs[data-bucket-shift="-19"]'
    )!
    extreme.dispatchEvent(new KeyboardEvent("keydown", { key: " " }))
    expect(browseCurrentDisagreementCards).toHaveBeenLastCalledWith([8])
    expect(extreme.querySelector("title")?.textContent).toContain('"shift":"-19"')
    expect(svg.querySelector('[data-bucket-shift="0"]')?.getAttribute("fill")).toBe("grey")
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)

    renderCurrentRetrievabilityGraph(svg, bins, { colorByBucketShift: false })
    expect(columnHeights()).toEqual(originalHeights)
    expect(svg.querySelectorAll("[data-bucket-shift]")).toHaveLength(0)
    expect(new Set(bars().map((bar) => bar.getAttribute("fill")))).toEqual(
        new Set(["grey", "seagreen", "steelblue"])
    )
    renderCurrentRetrievabilityGraph(svg, buildCurrentRetrievabilityBins([]), {
        colorByBucketShift: true,
    })
    expect(svg.children).toHaveLength(0)
})
