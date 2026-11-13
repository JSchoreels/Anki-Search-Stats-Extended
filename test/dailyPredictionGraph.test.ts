/** @jest-environment jsdom */

jest.mock("../src/ts/i18n", () => ({
    i18n: (key: string, args?: Record<string, string | number>) =>
        `${key}${args ? ": " + Object.values(args).join(", ") : ""}`,
}))
jest.mock("../src/ts/stores", () => ({
    tooltip: { set: jest.fn() },
    tooltipShown: { set: jest.fn() },
}))

import {
    dailyPredictionTooltip,
    renderDailyPredictionGraph as render,
} from "../src/ts/DailyPredictionGraph"
import type { DailyPredictionPoint } from "../src/ts/dailyPredictionData"
import { tooltip, tooltipShown } from "../src/ts/stores"

const point = (day: number, standardizedGap: number | null = 0): DailyPredictionPoint => ({
    day,
    count: 20,
    actualRecall: 0.8,
    predictedRecall: 0.9,
    standardizedGap,
    logLoss: 0.786,
})
const rawGapPoint = (day: number, gap: number): DailyPredictionPoint => ({
    ...point(day),
    actualRecall: (100 + gap) / 200,
    predictedRecall: (100 - gap) / 200,
})
const renderDailyPredictionGraph = (
    svg: SVGElement,
    data: DailyPredictionPoint[],
    metric: "standardizedGap" | "logLoss"
) => render(svg, [{ model: "rwkv", data }], metric)
const svgElement = () => document.createElementNS("http://www.w3.org/2000/svg", "svg")

test("rounding near-zero gaps does not display negative zero", () => {
    expect(dailyPredictionTooltip(point(20000, -1e-12), "standardizedGap")[1]).toBe(
        "daily-prediction-standardizedGap-value: 0.000"
    )
    expect(dailyPredictionTooltip({ ...point(20000), actualRecall: 0.89999 }, "rawGap")[1]).toBe(
        "daily-prediction-rawGap-value: 0.0"
    )
})

test("arbitrary selected models use their labels, colors and all-review recall counts", () => {
    const svg = svgElement()
    const data = [{ ...point(20000), actualCount: 50 }]
    render(
        svg,
        [
            { model: "rwkv-big", label: "RWKV Big", color: "steelblue", dashed: false, data },
            {
                model: "rwkv-tiny-instant",
                label: "RWKV Tiny Instant",
                color: "seagreen",
                dashed: true,
                data,
            },
        ],
        "rawGap",
        7
    )
    expect(svg.textContent).toContain("RWKV Big")
    expect(svg.textContent).toContain("RWKV Tiny Instant")
    const first = svg.querySelector('[data-model="rwkv-big"]')!
    const second = svg.querySelector('[data-model="rwkv-tiny-instant"]')!
    expect(first.querySelector(".daily-prediction-average")?.getAttribute("stroke")).toBe(
        "steelblue"
    )
    expect(second.querySelector(".daily-prediction-average")?.getAttribute("stroke")).toBe(
        "seagreen"
    )
    expect(
        first.querySelector(".daily-prediction-series")?.getAttribute("stroke-dasharray")
    ).toBeNull()
    expect(second.querySelector(".daily-prediction-series")?.getAttribute("stroke-dasharray")).toBe(
        "3 3"
    )
    expect(svg.querySelector(".daily-prediction-hover")?.getAttribute("aria-label")).toContain(
        "daily-prediction-actual-all: 80.0, 50"
    )
    expect(svg.querySelector(".daily-prediction-hover")?.getAttribute("aria-label")).toContain(
        "daily-prediction-prediction-count: 20"
    )
    expect(svg.querySelector(".daily-prediction-hover")?.getAttribute("aria-label")).toContain(
        "daily-prediction-average-predicted: 90.0"
    )
})

test("raw differences show signed percentage points and smooth the selected view", () => {
    const svg = svgElement()
    const data = [
        { ...point(20000), actualRecall: 0.6, predictedRecall: 0.4 },
        { ...point(20001, null), actualRecall: 0.5, predictedRecall: 0.7 },
        { ...point(20002), actualRecall: 0.65, predictedRecall: 0.7 },
    ]
    render(svg, [{ model: "fsrs", data }], "rawGap", 2)

    const zeroY = Number(svg.querySelector(".daily-prediction-zero")!.getAttribute("y1"))
    const points = [...svg.querySelectorAll(".daily-prediction-point")]
    expect(points).toHaveLength(3)
    expect(Number(points[0].getAttribute("cy"))).toBeLessThan(zeroY)
    expect(Number(points[1].getAttribute("cy"))).toBeGreaterThan(zeroY)
    expect(svg.textContent).toContain("daily-prediction-rawGap-axis")
    const secondDay = svg.querySelectorAll(".daily-prediction-hover")[1]
    expect(secondDay.getAttribute("aria-label")).toContain("daily-prediction-rawGap-value: -20.0")
    expect(secondDay.getAttribute("aria-label")).toContain(
        "daily-prediction-rawGap-average-value: 2, 0.0"
    )

    render(svg, [{ model: "fsrs", data }], "rawGap", 2, { start: 20002, end: 20002 })
    expect(svg.querySelector(".daily-prediction-hover")!.getAttribute("aria-label")).toContain(
        "daily-prediction-rawGap-average-value: 2, -12.5"
    )
})

test("raw gaps use the visible absolute P95 across models and keep clipped values in tooltips", () => {
    const svg = svgElement()
    const fsrs = Array.from({ length: 10 }, (_, index) => rawGapPoint(20000 + index, 10))
    const rwkv = Array.from({ length: 10 }, (_, index) =>
        rawGapPoint(20000 + index, index === 9 ? 90 : -10)
    )
    const series = [
        { model: "fsrs" as const, data: fsrs },
        { model: "rwkv" as const, data: rwkv },
    ]
    render(svg, series, "rawGap")

    const clip = svg.querySelector("clipPath")!
    const height = Number(clip.querySelector("rect")!.getAttribute("height"))
    const zeroY = Number(svg.querySelector(".daily-prediction-zero")!.getAttribute("y1"))
    const fsrsPoint = svg.querySelector('[data-model="fsrs"] .daily-prediction-point')!
    const rwkvPoints = svg.querySelectorAll('[data-model="rwkv"] .daily-prediction-point')
    // Nineteen absolute gaps are 10 and one is 90, so linear-interpolated P95 is 14.
    expect(zeroY).toBe(height / 2)
    expect(Number(fsrsPoint.getAttribute("cy"))).toBeCloseTo((height / 2) * (1 - 10 / 14))
    expect(Number(rwkvPoints[0].getAttribute("cy"))).toBeCloseTo((height / 2) * (1 + 10 / 14))
    expect(Number(rwkvPoints[9].getAttribute("cy"))).toBeLessThan(0)
    for (const group of svg.querySelectorAll("[data-model]"))
        expect(group.getAttribute("clip-path")).toBe(`url(#${clip.id})`)
    expect(svg.querySelectorAll(".daily-prediction-hover")[9].getAttribute("aria-label")).toContain(
        "daily-prediction-rawGap-value: 90.0"
    )

    render(svg, series, "rawGap", null, { start: 20000, end: 20008 })
    expect(Number(svg.querySelector('[data-model="fsrs"] circle')!.getAttribute("cy"))).toBeCloseTo(
        0
    )
    expect(Number(svg.querySelector('[data-model="rwkv"] circle')!.getAttribute("cy"))).toBeCloseTo(
        height
    )
    expect(svg.querySelectorAll(".daily-prediction-hover")).toHaveLength(9)
})

test("raw-gap smoothing scales to the visible moving averages with five percent headroom", () => {
    const svg = svgElement()
    const fsrs = [rawGapPoint(20000, 80), rawGapPoint(20001, -80), rawGapPoint(20002, 0)]
    const rwkv = [rawGapPoint(20000, 20), rawGapPoint(20001, 20), rawGapPoint(20002, 20)]
    render(
        svg,
        [
            { model: "fsrs", data: fsrs },
            { model: "rwkv", data: rwkv },
        ],
        "rawGap",
        2,
        { start: 20001, end: 20002 }
    )

    const height = Number(svg.querySelector("clipPath rect")!.getAttribute("height"))
    const zeroY = Number(svg.querySelector(".daily-prediction-zero")!.getAttribute("y1"))
    const fsrsPoints = svg.querySelectorAll('[data-model="fsrs"] .daily-prediction-point')
    const rwkvPoint = svg.querySelector('[data-model="rwkv"] .daily-prediction-point')!
    // The visible FSRS averages are 0 and -40; the RWKV averages are 20.
    expect(zeroY).toBe(height / 2)
    expect(Number(rwkvPoint.getAttribute("cy"))).toBeCloseTo((height / 2) * (1 - 20 / 42))
    expect(Number(fsrsPoints[0].getAttribute("cy"))).toBeGreaterThan(height)
    const days = svg.querySelectorAll(".daily-prediction-hover")
    expect(days[0].getAttribute("aria-label")).toContain("daily-prediction-rawGap-value: -80.0")
    expect(days[0].getAttribute("aria-label")).toContain(
        "daily-prediction-rawGap-average-value: 2, 0.0"
    )
    expect(days[1].getAttribute("aria-label")).toContain(
        "daily-prediction-rawGap-average-value: 2, -40.0"
    )
})

test.each([null, 2])(
    "raw-gap zero values and empty zoom ranges stay finite with averaging %s",
    (days) => {
        const svg = svgElement()
        const series = [
            { model: "fsrs" as const, data: [rawGapPoint(20000, 0), rawGapPoint(20002, 0)] },
        ]
        render(svg, series, "rawGap", days)
        expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
        expect(svg.querySelector(".daily-prediction-point")!.getAttribute("cy")).toBe(
            svg.querySelector(".daily-prediction-zero")!.getAttribute("y1")
        )
        render(svg, series, "rawGap", days, { start: 20001, end: 20001 })
        expect(svg.querySelectorAll(".daily-prediction-hover")).toHaveLength(0)
        expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
    }
)

test("raw-gap clipping uses separate IDs and leaves other metrics unclipped", () => {
    const first = svgElement()
    const second = svgElement()
    const series = [{ model: "fsrs" as const, data: [rawGapPoint(20000, 10)] }]
    render(first, series, "rawGap")
    render(second, series, "rawGap")
    expect(first.querySelector("clipPath")!.id).not.toBe(second.querySelector("clipPath")!.id)
    render(first, series, "standardizedGap")
    expect(first.querySelector("clipPath")).toBeNull()
    expect(first.querySelector("[data-model]")!.hasAttribute("clip-path")).toBe(false)
})

test("averaged curves can bridge missing days without inventing daily points or tooltips", () => {
    const svg = svgElement()
    const data = [rawGapPoint(20000, 10), rawGapPoint(20003, -10)]
    const series = [{ model: "fsrs" as const, data }]
    render(svg, series, "rawGap", 2, undefined, undefined, { mode: "study", connectGaps: true })
    expect(svg.querySelectorAll(".daily-prediction-average-gap")).toHaveLength(1)
    expect(
        svg.querySelector(".daily-prediction-average-gap")!.getAttribute("stroke-dasharray")
    ).toBe("2 4")
    expect(svg.querySelectorAll(".daily-prediction-point")).toHaveLength(2)
    expect(svg.querySelectorAll(".daily-prediction-hover")).toHaveLength(2)
    render(svg, series, "rawGap", 2, undefined, undefined, { mode: "study", connectGaps: false })
    expect(svg.querySelectorAll(".daily-prediction-average-gap")).toHaveLength(0)
})

test("review-based values control the raw-gap scale and tooltip", () => {
    const svg = svgElement()
    const data = [rawGapPoint(20000, 80), rawGapPoint(20001, -80)]
    render(svg, [{ model: "fsrs", data }], "rawGap", 1000, undefined, undefined, {
        mode: "reviews",
        reviewValues: {
            fsrs: [
                { day: 20000, value: 10 },
                { day: 20001, value: -20 },
            ],
            rwkv: [],
        },
    })
    expect(svg.querySelectorAll(".daily-prediction-hover")[1].getAttribute("aria-label")).toContain(
        "averaging-raw-value: averaging-review-window: 1000, -20.0"
    )
    const height = Number(svg.querySelector("clipPath rect")!.getAttribute("height"))
    expect(Number(svg.querySelector(".daily-prediction-point")!.getAttribute("cy"))).toBeLessThan(0)
    expect(Number(svg.querySelector(".daily-prediction-zero")!.getAttribute("y1"))).toBe(height / 2)
})

test("recall gaps render on both sides of zero and do not join across missing days", () => {
    const svg = svgElement()
    renderDailyPredictionGraph(
        svg,
        [point(20000, -2), point(20001, 0), point(20003, 2)],
        "standardizedGap"
    )

    const zeroY = Number(svg.querySelector(".daily-prediction-zero")!.getAttribute("y1"))
    const points = [...svg.querySelectorAll(".daily-prediction-point")]
    expect(points).toHaveLength(3)
    expect(Number(points[0].getAttribute("cy"))).toBeGreaterThan(zeroY)
    expect(Number(points[1].getAttribute("cy"))).toBe(zeroY)
    expect(Number(points[2].getAttribute("cy"))).toBeLessThan(zeroY)
    expect(
        svg.querySelector(".daily-prediction-series")!.getAttribute("d")!.match(/M/g)
    ).toHaveLength(2)
    expect(svg.querySelectorAll(".daily-prediction-hover")).toHaveLength(3)
    expect(svg.textContent).toContain("daily-prediction-standardizedGap-axis")
})

test("tooltips expose metric, actual R, predicted R and count through hover and keyboard focus", () => {
    const svg = svgElement()
    renderDailyPredictionGraph(svg, [point(20000, -1.490712)], "standardizedGap")
    const target = svg.querySelector(".daily-prediction-hover")!
    expect(target.getAttribute("tabindex")).toBe("0")
    target.dispatchEvent(new MouseEvent("mouseover", { clientX: 100, clientY: 100 }))
    expect(tooltip.set).toHaveBeenLastCalledWith(
        expect.objectContaining({
            text: [
                "2024-10-04",
                "calibration-source-rwkv",
                "daily-prediction-standardizedGap-value: -1.491",
                "daily-prediction-actual: 80.0",
                "daily-prediction-predicted: 90.0",
                "daily-prediction-count: 20",
            ],
        })
    )
    expect(tooltipShown.set).toHaveBeenLastCalledWith(true)
    target.dispatchEvent(new MouseEvent("mouseleave"))
    expect(tooltipShown.set).toHaveBeenLastCalledWith(false)
    target.dispatchEvent(new FocusEvent("focus"))
    expect(tooltipShown.set).toHaveBeenLastCalledWith(true)
    target.dispatchEvent(new FocusEvent("blur"))
    expect(tooltipShown.set).toHaveBeenLastCalledWith(false)
})

test("undefined gaps stay available in tooltips without inventing a point at zero", () => {
    const svg = svgElement()
    renderDailyPredictionGraph(svg, [point(20000, null)], "standardizedGap")
    expect(svg.querySelectorAll(".daily-prediction-point")).toHaveLength(0)
    expect(svg.querySelector(".daily-prediction-hover")!.getAttribute("aria-label")).toContain(
        "daily-prediction-gap-unavailable"
    )
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
})

test("average log loss supports a single day, zero loss, redraws and empty searches", () => {
    const svg = svgElement()
    renderDailyPredictionGraph(svg, [{ ...point(20000), logLoss: 0 }], "logLoss")
    expect(svg.querySelectorAll(".daily-prediction-point")).toHaveLength(1)
    expect(svg.textContent).toContain("daily-prediction-logLoss-axis")
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
    renderDailyPredictionGraph(svg, [point(20000), point(20001)], "logLoss")
    expect(svg.querySelectorAll(".daily-prediction-series")).toHaveLength(1)
    expect(svg.querySelectorAll(".daily-prediction-point")).toHaveLength(2)
    renderDailyPredictionGraph(svg, [], "logLoss")
    expect(svg.children).toHaveLength(0)
})

test("both models share axes but retain their independent days, counts, and tooltips", () => {
    const svg = svgElement()
    render(
        svg,
        [
            { model: "fsrs", data: [point(20000, -5), { ...point(20001, 1), count: 10 }] },
            { model: "rwkv", data: [point(20001, -2), point(20002, 3)] },
        ],
        "standardizedGap"
    )
    expect(svg.querySelectorAll(".daily-prediction-series")).toHaveLength(2)
    expect(svg.querySelector('[data-model="fsrs"] path')!.getAttribute("stroke")).toBe("steelblue")
    expect(svg.querySelector('[data-model="rwkv"] path')!.getAttribute("stroke")).toBe("seagreen")
    const targets = [...svg.querySelectorAll(".daily-prediction-hover")]
    expect(targets).toHaveLength(3)
    expect(targets[0].getAttribute("aria-label")).not.toContain("calibration-source-rwkv")
    expect(targets[1].getAttribute("aria-label")).toContain("daily-prediction-count: 10")
    expect(targets[1].getAttribute("aria-label")).toContain("daily-prediction-count: 20")
    expect(targets[2].getAttribute("aria-label")).not.toContain("calibration-source-fsrs")
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
})

test.each(["standardizedGap", "logLoss"] as const)(
    "%s averages grey the daily values and restore model colors when disabled",
    (metric) => {
        const svg = svgElement()
        const data = [
            { ...point(20000, -2), logLoss: 0.2 },
            { ...point(20001, 2), logLoss: 0.8 },
            { ...point(20003, 4), logLoss: 1 },
        ]
        const series = [
            { model: "fsrs" as const, data },
            { model: "rwkv" as const, data },
        ]
        render(svg, series, metric, 2)
        expect(svg.querySelectorAll(".daily-prediction-average")).toHaveLength(2)
        for (const raw of svg.querySelectorAll(".daily-prediction-series")) {
            expect(raw.getAttribute("stroke")).toBe("#888")
            expect(raw.getAttribute("opacity")).toBe("0.35")
        }
        expect(
            svg
                .querySelector('[data-model="fsrs"] .daily-prediction-average')!
                .getAttribute("stroke")
        ).toBe("steelblue")
        const average = svg.querySelector('[data-model="rwkv"] .daily-prediction-average')!
        expect(average.getAttribute("stroke")).toBe("seagreen")
        expect(average.getAttribute("d")!.match(/M/g)).toHaveLength(2)
        const target = svg.querySelectorAll(".daily-prediction-hover")[1]
        expect(target.getAttribute("aria-label")).toContain(
            `daily-prediction-average-value: 2, ${metric === "logLoss" ? "0.500" : "0.000"}`
        )
        target.dispatchEvent(new FocusEvent("focus"))
        expect(tooltip.set).toHaveBeenLastCalledWith(
            expect.objectContaining({
                text: expect.arrayContaining([
                    `daily-prediction-average-value: 2, ${metric === "logLoss" ? "0.500" : "0.000"}`,
                ]),
            })
        )
        render(svg, series, metric)
        expect(svg.querySelectorAll(".daily-prediction-average")).toHaveLength(0)
        expect(svg.querySelector('[data-model="fsrs"] path')!.getAttribute("stroke")).toBe(
            "steelblue"
        )
        expect(svg.querySelector('[data-model="rwkv"] path')!.getAttribute("stroke")).toBe(
            "seagreen"
        )
    }
)

test("moving averages preserve undefined recall gaps and allow one model to be unavailable", () => {
    const svg = svgElement()
    render(
        svg,
        [
            { model: "fsrs", data: [] },
            { model: "rwkv", data: [point(20000, -1), point(20001, null), point(20002, 1)] },
        ],
        "standardizedGap",
        7
    )
    const average = svg.querySelector(".daily-prediction-average")!
    expect(average.getAttribute("d")!.match(/M/g)).toHaveLength(2)
    expect(svg.querySelectorAll(".daily-prediction-average-point")).toHaveLength(2)
    expect(svg.querySelectorAll(".daily-prediction-hover")[1].getAttribute("aria-label")).toContain(
        "daily-prediction-average-value: 7, daily-prediction-gap-unavailable"
    )
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
})

test("daily zoom crops both models and tooltips after averaging the full history", () => {
    const svg = svgElement()
    const data = [point(20000, 20), point(20001, 2), point(20002, 4), point(20004, 6)]
    const onZoom = jest.fn()
    const options = render(
        svg,
        [
            { model: "fsrs", data },
            { model: "rwkv", data },
        ],
        "standardizedGap",
        3,
        { start: 20002, end: 20004 },
        onZoom
    )!
    expect(svg.querySelectorAll(".daily-prediction-hover")).toHaveLength(2)
    expect(svg.querySelectorAll(".daily-prediction-point")).toHaveLength(4)
    expect(svg.querySelector(".daily-prediction-hover")?.getAttribute("aria-label")).toContain(
        "daily-prediction-average-value: 3, 8.667"
    )
    expect(
        svg.querySelector(".daily-prediction-average")?.getAttribute("d")!.match(/M/g)
    ).toHaveLength(2)
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
    options.onSelect(0, 0.33)
    expect(onZoom).toHaveBeenCalledWith({ start: 20002, end: 20002 })
    expect(data[0].standardizedGap).toBe(20)
    render(svg, [{ model: "fsrs", data }], "standardizedGap", 3, { start: 20003, end: 20003 })
    expect(svg.querySelectorAll(".daily-prediction-hover")).toHaveLength(0)
    expect(svg.innerHTML).not.toMatch(/NaN|Infinity/)
})
