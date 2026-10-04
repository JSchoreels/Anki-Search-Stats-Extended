import * as d3 from "d3"
import type {
    CurrentRetrievabilityBin,
    CurrentRetrievabilityMembership,
} from "./currentRetrievabilityData"
import {
    clearChart,
    comparisonGraphBounds,
    FSRS_COMPARISON_COLOUR,
    RWKV_COMPARISON_COLOUR,
} from "./graph"
import { i18n } from "./i18n"
import { browseCurrentDisagreementCards } from "./search"

export const CURRENT_RETRIEVABILITY_SERIES: {
    key: CurrentRetrievabilityMembership
    color: string
}[] = [
    { key: "both", color: "grey" },
    { key: "rwkv", color: RWKV_COMPARISON_COLOUR },
    { key: "fsrs", color: FSRS_COMPARISON_COLOUR },
]

const MAX_SHIFT_SHADE = 5

export function currentRetrievabilityShiftColor(shift: number): string {
    if (shift === 0) return "grey"
    const level = Math.min(Math.abs(shift), MAX_SHIFT_SHADE)
    return d3.hsl(shift > 0 ? 135 : 0, 0.2 + level * 0.14, 0.85 - level * 0.09).formatHex()
}

export const CURRENT_RETRIEVABILITY_SHIFT_SERIES = d3
    .range(-MAX_SHIFT_SHADE, MAX_SHIFT_SHADE + 1)
    .map((shift) => ({ shift, color: currentRetrievabilityShiftColor(shift) }))

export function currentRetrievabilityShiftLabel(shift: number): string {
    if (shift === -MAX_SHIFT_SHADE) return i18n("current-retrievability-shift-lower")
    if (shift === MAX_SHIFT_SHADE) return i18n("current-retrievability-shift-higher")
    return shift > 0 ? `+${shift}` : String(shift)
}

type RetrievabilitySegment = {
    key: CurrentRetrievabilityMembership
    color: string
    shift: number
    cids: number[]
}

function retrievabilitySegments(
    bin: CurrentRetrievabilityBin,
    colorByBucketShift: boolean
): RetrievabilitySegment[] {
    const segments = CURRENT_RETRIEVABILITY_SERIES.flatMap(({ key, color }) => {
        if (!colorByBucketShift || key === "both") {
            return [{ key, color, shift: 0, cids: bin[key] }]
        }
        return Object.entries(bin.shifts[key]).map(([shift, cids]) => ({
            key,
            color: currentRetrievabilityShiftColor(Number(shift)),
            shift: Number(shift),
            cids,
        }))
    })
    return colorByBucketShift ? segments.sort((a, b) => a.shift - b.shift) : segments
}

function shiftCounts(segments: RetrievabilitySegment[]) {
    const counts = new Map(CURRENT_RETRIEVABILITY_SHIFT_SERIES.map(({ shift }) => [shift, 0]))
    let above = 0
    let total = 0
    for (const { shift, cids } of segments) {
        const level = Math.max(-MAX_SHIFT_SHADE, Math.min(MAX_SHIFT_SHADE, shift))
        counts.set(level, counts.get(level)! + cids.length)
        total += cids.length
        if (shift > 0) above += cids.length
    }
    return { counts, above, total }
}

function shiftSummary(
    bucket: ReturnType<typeof shiftCounts>,
    search: ReturnType<typeof shiftCounts>
): string[] {
    return [
        i18n("current-retrievability-shift-counts"),
        ...CURRENT_RETRIEVABILITY_SHIFT_SERIES.map(({ shift }) =>
            i18n("current-retrievability-shift-count", {
                shift: currentRetrievabilityShiftLabel(shift),
                count: bucket.counts.get(shift)!,
                searchCount: search.counts.get(shift)!,
            })
        ),
        i18n("current-retrievability-bucket-total", {
            count: bucket.total,
            searchCount: search.total,
        }),
        i18n("current-retrievability-above-total", {
            count: bucket.above,
            searchCount: search.above,
        }),
    ]
}

export function renderCurrentRetrievabilityGraph(
    svg: SVGElement,
    bins: CurrentRetrievabilityBin[],
    { colorByBucketShift = false } = {}
) {
    clearChart(svg)
    const maxCount = d3.max(bins, (bin) => bin.both.length + bin.rwkv.length + bin.fsrs.length) ?? 0
    if (!maxCount) return

    const { width, height } = comparisonGraphBounds()
    const x = d3.scaleLinear().domain([0, 1]).range([0, width])
    const y = d3.scaleLinear().domain([0, maxCount]).nice().range([height, 0])
    const chart = d3.select(svg).attr("viewBox", `-70 -15 ${width + 90} ${height + 75}`)
    chart
        .append("g")
        .attr("class", "current-retrievability-y-axis")
        .call(d3.axisLeft(y).ticks(Math.min(6, maxCount)).tickFormat(d3.format("d")))
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -52)
        .attr("fill", "currentColor")
        .attr("text-anchor", "middle")
        .text(i18n("cards"))
    chart
        .append("g")
        .attr("class", "current-retrievability-x-axis")
        .attr("transform", `translate(0, ${height})`)
        .call(
            d3
                .axisBottom(x)
                .tickValues(d3.range(0, 11).map((v) => v / 10))
                .tickFormat(d3.format(".0%"))
        )
        .append("text")
        .attr("x", width / 2)
        .attr("y", 42)
        .attr("fill", "currentColor")
        .attr("text-anchor", "middle")
        .text(i18n("current-retrievability-x-axis"))

    // Agreement and RWKV membership together include each paired card exactly once.
    const searchCounts = colorByBucketShift
        ? shiftCounts(
              bins.flatMap((bin) =>
                  retrievabilitySegments(bin, true).filter(({ key }) => key !== "fsrs")
              )
          )
        : null
    for (const bin of bins) {
        let cumulative = 0
        const segments = retrievabilitySegments(bin, colorByBucketShift)
        const summary = searchCounts ? shiftSummary(shiftCounts(segments), searchCounts) : []
        for (const { key, color, shift, cids } of segments) {
            const base = cumulative
            cumulative += cids.length
            if (!cids.length) continue
            const segmentLabel = i18n(
                colorByBucketShift
                    ? "current-retrievability-shift-bucket"
                    : "current-retrievability-bucket",
                {
                    lower: d3.format(".0%")(bin.lower),
                    upper: d3.format(".0%")(bin.upper),
                    membership: i18n(`current-retrievability-${key}`),
                    count: cids.length,
                    shift: shift > 0 ? `+${shift}` : String(shift),
                }
            )
            const label = [segmentLabel, ...summary].join("\n")
            chart
                .append("rect")
                .attr("class", `current-retrievability-bar current-retrievability-${key}`)
                .attr("data-bucket-shift", colorByBucketShift ? shift : null)
                .attr("x", x(bin.lower) + 1)
                .attr("width", Math.max(1, x(bin.upper) - x(bin.lower) - 2))
                .attr("y", y(cumulative))
                .attr("height", y(base) - y(cumulative))
                .attr("fill", color)
                .attr("role", "button")
                .attr("tabindex", 0)
                .attr("aria-label", label)
                .style("cursor", "pointer")
                .on("click", () => browseCurrentDisagreementCards(cids))
                .on("keydown", (event: KeyboardEvent) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        browseCurrentDisagreementCards(cids)
                    }
                })
                .append("title")
                .text(label)
        }
    }
}
