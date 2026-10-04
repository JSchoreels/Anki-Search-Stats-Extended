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

export function renderCurrentRetrievabilityGraph(
    svg: SVGElement,
    bins: CurrentRetrievabilityBin[]
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
        for (const { key, color } of CURRENT_RETRIEVABILITY_SERIES) {
            const cids = bin[key]
            const base = cumulative
            cumulative += cids.length
            if (!cids.length) continue
            const label = i18n("current-retrievability-bucket", {
                lower: d3.format(".0%")(bin.lower),
                upper: d3.format(".0%")(bin.upper),
                membership: i18n(`current-retrievability-${key}`),
                count: cids.length,
            })
            chart
                .append("rect")
                .attr("class", `current-retrievability-bar current-retrievability-${key}`)
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
