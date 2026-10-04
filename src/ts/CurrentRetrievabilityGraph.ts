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
    return CURRENT_RETRIEVABILITY_SERIES.flatMap(({ key, color }) => {
        if (!colorByBucketShift || key === "both") {
            return [{ key, color, shift: 0, cids: bin[key] }]
        }
        return Object.entries(bin.shifts[key])
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([shift, cids]) => ({
                key,
                color: currentRetrievabilityShiftColor(Number(shift)),
                shift: Number(shift),
                cids,
            }))
    })
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

    for (const bin of bins) {
        let cumulative = 0
        for (const { key, color, shift, cids } of retrievabilitySegments(bin, colorByBucketShift)) {
            const base = cumulative
            cumulative += cids.length
            if (!cids.length) continue
            const label = i18n(
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
