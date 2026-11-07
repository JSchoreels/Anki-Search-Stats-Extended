import * as d3 from "d3"
import { clearChart, comparisonGraphBounds } from "./graph"
import { i18n } from "./i18n"
import { tooltip, tooltipShown } from "./stores"
import { tooltipX } from "./tooltip"
import type { ForecastMetric, ForecastPoint } from "./workloadForecastData"

const COLOUR = "#4f8bc9"

const dayLabel = (day: number) => {
    if (day === 0) return i18n("workload-forecast-today")
    if (day === 1) return i18n("workload-forecast-tomorrow")
    return i18n("workload-forecast-day", { day })
}

const format = (value: number, metric: ForecastMetric) =>
    metric === "minutes" ? value.toFixed(1) : String(Math.round(value))

export function workloadForecastTooltip(point: ForecastPoint, metric: ForecastMetric) {
    const f = (value: number) => format(value, metric)
    return [
        dayLabel(point.day),
        i18n("workload-forecast-tooltip-mean", { value: f(point.mean) }),
        i18n("workload-forecast-tooltip-median", { value: f(point.p50) }),
        i18n("workload-forecast-tooltip-p90", { low: f(point.p5), high: f(point.p95) }),
        i18n("workload-forecast-tooltip-p98", { low: f(point.p1), high: f(point.p99) }),
    ]
}

export function renderWorkloadForecastGraph(
    svg: SVGElement,
    points: ForecastPoint[],
    metric: ForecastMetric
) {
    clearChart(svg)
    tooltipShown.set(false)
    if (!points.length) return
    const { width, height } = comparisonGraphBounds()
    const first = d3.min(points, (p) => p.day)!
    const last = d3.max(points, (p) => p.day)!
    const x = d3
        .scaleLinear()
        .domain([first, Math.max(last, first + 1)])
        .range([0, width])
    const top = d3.max(points, (p) => p.p99) || 1
    const y = d3.scaleLinear().domain([0, top]).nice().range([height, 0])
    const chart = d3.select(svg).attr("viewBox", `-70 -15 ${width + 90} ${height + 75}`)

    chart
        .append("g")
        .attr("class", "workload-forecast-y-axis")
        .call(d3.axisLeft(y).ticks(6))
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -52)
        .attr("fill", "currentColor")
        .attr("text-anchor", "middle")
        .text(
            i18n(metric === "minutes" ? "workload-forecast-y-minutes" : "workload-forecast-y-cards")
        )
    chart
        .append("g")
        .attr("class", "workload-forecast-x-axis")
        .attr("transform", `translate(0, ${height})`)
        .call(d3.axisBottom(x).ticks(Math.min(10, points.length)).tickFormat(d3.format("d")))
        .append("text")
        .attr("x", width / 2)
        .attr("y", 38)
        .attr("fill", "currentColor")
        .attr("text-anchor", "middle")
        .text(i18n("workload-forecast-x-axis"))

    const area = (low: (p: ForecastPoint) => number, high: (p: ForecastPoint) => number) =>
        d3
            .area<ForecastPoint>()
            .x((p) => x(p.day))
            .y0((p) => y(low(p)))
            .y1((p) => y(high(p)))
            .curve(d3.curveMonotoneX)(points)
    chart
        .append("path")
        .attr("class", "workload-forecast-band-p98")
        .attr(
            "d",
            area(
                (p) => p.p1,
                (p) => p.p99
            )
        )
        .attr("fill", COLOUR)
        .attr("fill-opacity", 0.15)
    chart
        .append("path")
        .attr("class", "workload-forecast-band-p90")
        .attr(
            "d",
            area(
                (p) => p.p5,
                (p) => p.p95
            )
        )
        .attr("fill", COLOUR)
        .attr("fill-opacity", 0.3)
    const line = (value: (p: ForecastPoint) => number) =>
        d3
            .line<ForecastPoint>()
            .x((p) => x(p.day))
            .y((p) => y(value(p)))
            .curve(d3.curveMonotoneX)(points)
    chart
        .append("path")
        .attr("class", "workload-forecast-median")
        .attr("d", line((p) => p.p50))
        .attr("fill", "none")
        .attr("stroke", COLOUR)
        .attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "5 3")
    chart
        .append("path")
        .attr("class", "workload-forecast-mean")
        .attr("d", line((p) => p.mean))
        .attr("fill", "none")
        .attr("stroke", COLOUR)
        .attr("stroke-width", 2.5)

    const guide = chart
        .append("line")
        .attr("y1", 0)
        .attr("y2", height)
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.4)
        .attr("visibility", "hidden")
    const bisect = d3.bisector((p: ForecastPoint) => p.day).center
    chart
        .append("rect")
        .attr("class", "workload-forecast-hover")
        .attr("width", width)
        .attr("height", height)
        .attr("fill", "transparent")
        .on("mousemove", (event: MouseEvent) => {
            const [px] = d3.pointer(event)
            const point = points[bisect(points, x.invert(px))]
            guide.attr("x1", x(point.day)).attr("x2", x(point.day)).attr("visibility", "visible")
            tooltip.set({
                x: tooltipX(event),
                y: event.pageY,
                text: workloadForecastTooltip(point, metric),
            })
            tooltipShown.set(true)
        })
        .on("mouseleave", () => {
            guide.attr("visibility", "hidden")
            tooltipShown.set(false)
        })
}
