/** @jest-environment jsdom */
jest.mock("../src/ts/i18n", () => ({
    i18n: (key: string, args?: Record<string, unknown>) => `${key} ${JSON.stringify(args ?? {})}`,
}))
jest.mock("../src/ts/search", () => ({ browseCurrentDisagreementCards: jest.fn() }))

import { buildCurrentDisagreementBins } from "../src/ts/currentDisagreementData"
import { renderCurrentDisagreementGraph } from "../src/ts/CurrentDisagreementGraph"
import { browseCurrentDisagreementCards } from "../src/ts/search"

test("current buckets retain exact card membership, signs and endpoint bounds", () => {
    const bins = buildCurrentDisagreementBins([
        { cid: 1, fsrs: 0, rwkv: 1 },
        { cid: 2, fsrs: 0.7, rwkv: 0.9 },
        { cid: 3, fsrs: 0.71, rwkv: 0.9 },
        { cid: 4, fsrs: 0.9, rwkv: 0.7 },
        { cid: 5, fsrs: 1, rwkv: 0 },
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
        { cid: 1, fsrs: 0.025, rwkv: 0 },
        { cid: 2, fsrs: 0, rwkv: 0.025 },
        { cid: 3, fsrs: 0.02499, rwkv: 0 },
        { cid: 4, fsrs: 0, rwkv: 0.02501 },
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
            { cid: 1, fsrs: NaN, rwkv: 0.5 },
            { cid: 2, fsrs: 0.8, rwkv: undefined as unknown as number },
            { cid: 3, fsrs: 0.8, rwkv: 1.1 },
            { cid: 4, fsrs: 0.8, rwkv: 0.8 },
            { cid: 4, fsrs: 0.8, rwkv: 0.8 },
        ]).map((b) => b.cids)
    ).toEqual([[4]])
})

test("all populated buckets render and mouse/keyboard open only their cards", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    const bins = buildCurrentDisagreementBins([
        { cid: 11, fsrs: 0.7, rwkv: 0.9 },
        { cid: 12, fsrs: 0.71, rwkv: 0.9 },
        { cid: 13, fsrs: 0.9, rwkv: 0.7 },
    ])
    renderCurrentDisagreementGraph(svg, bins)
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
