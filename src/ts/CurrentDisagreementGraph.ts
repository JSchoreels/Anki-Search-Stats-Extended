import * as d3 from "d3"
import type { CurrentDisagreementBin } from "./currentDisagreementData"
import { clearChart, comparisonGraphBounds } from "./graph"
import { i18n } from "./i18n"
import { browseCurrentDisagreementCards } from "./search"

const percent = (value: number) => `${value > 0 ? "+" : ""}${+(value * 100).toFixed(1)}%`

export function renderCurrentDisagreementGraph(
    svg: SVGElement,
    bins: CurrentDisagreementBin[],
    firstModel = i18n("calibration-source-fsrs"),
    secondModel = i18n("model-rwkv-current")
) {
    clearChart(svg)
    const { width, height } = comparisonGraphBounds()
    const lower = Math.floor((bins[0]?.lower ?? -0.1) * 10) / 10
    const upper = Math.ceil((bins[bins.length - 1]?.upper ?? 0.1) * 10) / 10
    const x = d3.scaleLinear().domain([lower, upper]).range([0, width])
    const maxCount = d3.max(bins, (bin) => bin.cids.length) ?? 1
    const y = d3.scaleLinear().domain([0, maxCount]).nice().range([height, 0])
    const chart = d3.select(svg).attr("viewBox", `-70 -15 ${width + 90} ${height + 75}`)
    chart
        .append("g")
        .attr("class", "current-disagreement-y-axis")
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
        .attr("class", "current-disagreement-x-axis")
        .attr("transform", `translate(0, ${height})`)
        .call(
            d3
                .axisBottom(x)
                .tickValues(
                    d3.range(Math.round(lower * 10), Math.round(upper * 10) + 1).map((v) => v / 10)
                )
                .tickFormat((v) => percent(+v))
        )
        .append("text")
        .attr("x", width / 2)
        .attr("y", 42)
        .attr("fill", "currentColor")
        .attr("text-anchor", "middle")
        .text(i18n("current-disagreement-x-axis", { first: firstModel, second: secondModel }))
    if (lower <= 0 && upper >= 0)
        chart
            .append("line")
            .attr("x1", x(0))
            .attr("x2", x(0))
            .attr("y1", 0)
            .attr("y2", height)
            .attr("stroke", "currentColor")
            .attr("stroke-opacity", 0.3)
            .attr("stroke-dasharray", "3 3")
    const label = (bin: CurrentDisagreementBin) =>
        i18n("current-disagreement-bucket", {
            lower: percent(bin.lower),
            upper: percent(bin.upper),
            count: bin.cids.length,
        })
    chart
        .append("g")
        .selectAll("rect")
        .data(bins)
        .join("rect")
        .attr("class", "current-disagreement-bar")
        .attr("x", (bin) => x(bin.lower) + 1)
        .attr("width", (bin) => Math.max(1, x(bin.upper) - x(bin.lower) - 2))
        .attr("y", (bin) => y(bin.cids.length))
        .attr("height", (bin) => height - y(bin.cids.length))
        .attr("fill", (bin) => (bin.center < 0 ? "seagreen" : "steelblue"))
        .attr("role", "button")
        .attr("tabindex", 0)
        .attr("aria-label", label)
        .style("cursor", "pointer")
        .on("click", (_, bin) => browseCurrentDisagreementCards(bin.cids))
        .on("keydown", (event: KeyboardEvent, bin) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                browseCurrentDisagreementCards(bin.cids)
            }
        })
        .append("title")
        .text(label)
}
