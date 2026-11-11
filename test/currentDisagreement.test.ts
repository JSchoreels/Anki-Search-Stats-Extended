/** @jest-environment jsdom */
jest.mock("../src/ts/i18n", () => ({
    i18n: (key: string, args?: Record<string, unknown>) => `${key} ${JSON.stringify(args ?? {})}`,
}))
jest.mock("../src/ts/search", () => ({ browseCurrentDisagreementCards: jest.fn() }))

import {
    buildCurrentDisagreementBins,
    pairCurrentModelScores,
} from "../src/ts/currentDisagreementData"
import { renderCurrentDisagreementGraph } from "../src/ts/CurrentDisagreementGraph"
import { browseCurrentDisagreementCards } from "../src/ts/search"

test("current buckets retain exact card membership, signs and endpoint bounds", () => {
    const bins = buildCurrentDisagreementBins([
        { cid: 1, first: 0, second: 1 },
        { cid: 2, first: 0.7, second: 0.9 },
        { cid: 3, first: 0.71, second: 0.9 },
        { cid: 4, first: 0.9, second: 0.7 },
        { cid: 5, first: 1, second: 0 },
    ])
    expect(bins.map((b) => [b.center, b.cids])).toEqual([
        [-1, [1]],
        [-0.2, [2, 3]],
        [0.2, [4]],
        [1, [5]],
    ])
    expect(bins[0].lower).toBe(-1)
    expect(bins[3].upper).toBe(1)
})

test("halfway boundaries follow UM+ rounding toward the higher center", () => {
    const bins = buildCurrentDisagreementBins([
        { cid: 1, first: 0.025, second: 0 },
        { cid: 2, first: 0, second: 0.025 },
        { cid: 3, first: 0.02499, second: 0 },
        { cid: 4, first: 0, second: 0.02501 },
    ])
    expect(bins.map((b) => [b.center, b.cids])).toEqual([
        [-0.05, [4]],
        [-0, [2, 3]],
        [0.05, [1]],
    ])
})

test("invalid or missing probabilities and duplicate cards cannot inflate counts", () => {
    expect(
        buildCurrentDisagreementBins([
            { cid: 1, first: NaN, second: 0.5 },
            { cid: 2, first: 0.8, second: undefined as unknown as number },
            { cid: 3, first: 0.8, second: 1.1 },
            { cid: 4, first: 0.8, second: 0.8 },
            { cid: 4, first: 0.8, second: 0.8 },
        ]).map((b) => b.cids)
    ).toEqual([[4]])
})

test("any selected models use only their paired current cards, in selector order", () => {
    const first: [number, number][] = [
        [1, 0.8],
        [2, 0.3],
        [3, NaN],
        [4, 0.4],
        [1, 0.9],
    ]
    const second: [number, number][] = [
        [2, 0.9],
        [1, 0.2],
        [3, 0.8],
        [5, 0.5],
    ]
    const forward = buildCurrentDisagreementBins(pairCurrentModelScores(first, second))
    const reversed = buildCurrentDisagreementBins(pairCurrentModelScores(second, first))
    expect(forward.map((bin) => [bin.center, bin.cids])).toEqual([
        [-0.6, [2]],
        [0.6, [1]],
    ])
    expect(reversed.map((bin) => [bin.center, bin.cids])).toEqual([
        [-0.6, [1]],
        [0.6, [2]],
    ])
})

test("all populated buckets render and mouse/keyboard open only their cards", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    const bins = buildCurrentDisagreementBins([
        { cid: 11, first: 0.7, second: 0.9 },
        { cid: 12, first: 0.71, second: 0.9 },
        { cid: 13, first: 0.9, second: 0.7 },
    ])
    renderCurrentDisagreementGraph(svg, bins, "RWKV Big", "RWKV Tiny Instant")
    expect(svg.textContent).toContain('"first":"RWKV Big"')
    expect(svg.textContent).toContain('"second":"RWKV Tiny Instant"')
    const bars = [...svg.querySelectorAll<SVGRectElement>(".current-disagreement-bar")]
    expect(bars).toHaveLength(2)
    expect(+bars[0].getAttribute("height")!).toBeCloseTo(2 * +bars[1].getAttribute("height")!)
    bars[0].dispatchEvent(new MouseEvent("click"))
    expect(browseCurrentDisagreementCards).toHaveBeenLastCalledWith([11, 12])
    bars[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
    expect(browseCurrentDisagreementCards).toHaveBeenLastCalledWith([13])
    bars[0].dispatchEvent(new KeyboardEvent("keydown", { key: " " }))
    expect(browseCurrentDisagreementCards).toHaveBeenLastCalledWith([11, 12])
    expect(bars[0].getAttribute("role")).toBe("button")
    expect(bars[0].querySelector("title")?.textContent).toContain('"count":2')
    renderCurrentDisagreementGraph(svg, [])
    expect(svg.querySelectorAll(".current-disagreement-bar")).toHaveLength(0)
})
