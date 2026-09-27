import * as d3 from "d3"
import {
    clearChart,
    COMPARISON_REFERENCE_COLOUR,
    comparisonGraphBounds,
    RWKV_COMPARISON_COLOUR,
} from "./graph"
import { i18n } from "./i18n"
import { gridLines } from "./LineGraph"
import { day_ms } from "./revlogGraphs"
import type { RwkvDailyMetric, RwkvDailyPoint } from "./rwkvDailyData"
import { tooltip, tooltipShown } from "./stores"
import { tooltipX } from "./tooltip"

const dateLabel = (day: number) => d3.utcFormat("%Y-%m-%d")(new Date(day * day_ms))

export function rwkvDailyTooltip(point: RwkvDailyPoint, metric: RwkvDailyMetric) {
    const value = point[metric]
    return [
        dateLabel(point.day),
        i18n(`rwkv-daily-${metric}-value`, {
            value:
                value === null
                    ? i18n("rwkv-daily-gap-unavailable")
                    : (Math.abs(value) < 0.0005 ? 0 : value).toFixed(3),
        }),
        i18n("rwkv-daily-actual", { value: (point.actualRecall * 100).toFixed(1) }),
        i18n("rwkv-daily-predicted", { value: (point.predictedRecall * 100).toFixed(1) }),
        i18n("rwkv-daily-count", { count: point.count }),
    ]
}

export function renderRwkvDailyGraph(
    svg: SVGElement,
    data: RwkvDailyPoint[],
    metric: RwkvDailyMetric
) {
    clearChart(svg)
    tooltipShown.set(false)
    if (!data.length) return

    const { width, height } = comparisonGraphBounds()
    const firstDay = data[0].day
    const lastDay = data[data.length - 1].day
    // Day indices already account for Anki's rollover; UTC keeps their calendar labels intact.
    const x = d3
        .scaleUtc()
        .domain([new Date((firstDay - 0.5) * day_ms), new Date((lastDay + 0.5) * day_ms)])
        .range([0, width])
    const magnitude = d3.max(data, (point) => Math.abs(point[metric] ?? 0)) || 1
    const y = d3
        .scaleLinear()
        .domain(metric === "standardizedGap" ? [-magnitude, magnitude] : [0, magnitude])
        .nice()
        .range([height, 0])
    const xTicks = x
        .ticks(Math.min(5, lastDay - firstDay + 1))
        .filter((date) => date.getUTCHours() === 0)
    const chart = d3
        .select(svg)
        .attr("viewBox", `-60 -10 ${width + 75} ${height + 60}`)
        .append("g")

    gridLines(chart, xTicks.map(x), y.ticks(6).map(y), { width, height })
    chart
        .append("g")
        .attr("class", "rwkv-daily-y-axis")
        .attr("opacity", 0.6)
        .call(d3.axisLeft(y).ticks(6))
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -42)
        .attr("text-anchor", "middle")
        .attr("fill", "currentColor")
        .text(i18n(`rwkv-daily-${metric}-axis`))
    chart
        .append("g")
        .attr("class", "rwkv-daily-x-axis")
        .attr("transform", `translate(0, ${height})`)
        .attr("opacity", 0.6)
        .call(
            d3
                .axisBottom(x)
                .tickValues(xTicks)
                .tickFormat((date) => d3.utcFormat("%d %b %Y")(date as Date))
        )

    chart
        .append("line")
        .attr("class", "rwkv-daily-zero")
        .attr("x1", 0)
        .attr("x2", width)
        .attr("y1", y(0))
        .attr("y2", y(0))
        .attr("stroke", COMPARISON_REFERENCE_COLOUR)
        .attr("stroke-dasharray", "5 4")

    const points: { day: number; value: number | null }[] = []
    data.forEach((point, index) => {
        if (index && point.day > data[index - 1].day + 1) {
            points.push({ day: point.day - 1, value: null })
        }
        points.push({ day: point.day, value: point[metric] })
    })
    chart
        .append("path")
        .attr("class", "rwkv-daily-series")
        .attr("fill", "none")
        .attr("stroke", RWKV_COMPARISON_COLOUR)
        .attr("stroke-width", 1.5)
        .attr(
            "d",
            d3
                .line<(typeof points)[number]>()
                .defined((point) => point.value !== null)
                .x((point) => x(new Date(point.day * day_ms)))
                .y((point) => y(point.value!))(points)
        )
    chart
        .selectAll("circle.rwkv-daily-point")
        .data(data.filter((point) => point[metric] !== null))
        .join("circle")
        .attr("class", "rwkv-daily-point")
        .attr("cx", (point) => x(new Date(point.day * day_ms)))
        .attr("cy", (point) => y(point[metric]!))
        .attr("r", 2.5)
        .attr("fill", RWKV_COMPARISON_COLOUR)

    chart
        .selectAll("rect.rwkv-daily-hover")
        .data(data)
        .join("rect")
        .attr("class", "rwkv-daily-hover")
        .attr("x", (point) => x(new Date((point.day - 0.5) * day_ms)))
        .attr("y", 0)
        .attr("width", width / (lastDay - firstDay + 1))
        .attr("height", height)
        .attr("fill", "transparent")
        .attr("tabindex", 0)
        .attr("aria-label", (point) => rwkvDailyTooltip(point, metric).join(". "))
        .on("mouseover mousemove", (event: MouseEvent, point) => {
            tooltip.set({
                x: tooltipX(event),
                y: event.pageY,
                text: rwkvDailyTooltip(point, metric),
            })
            tooltipShown.set(true)
        })
        .on("focus", (event: FocusEvent, point) => {
            const bounds = (event.currentTarget as SVGRectElement).getBoundingClientRect()
            tooltip.set({
                x: bounds.left + window.scrollX,
                y: bounds.top + window.scrollY,
                text: rwkvDailyTooltip(point, metric),
            })
            tooltipShown.set(true)
        })
        .on("mouseleave blur", () => tooltipShown.set(false))
}
