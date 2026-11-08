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
    if (point.scenarios) {
        const lines = [
            dayLabel(point.day),
            i18n("workload-forecast-tooltip-scenario-center", { value: f(point.scenarios.center) }),
        ]
        if (point.scenarios.minus !== undefined)
            lines.push(
                i18n("workload-forecast-tooltip-scenario-minus", {
                    value: f(point.scenarios.minus),
                })
            )
        if (point.scenarios.plus !== undefined)
            lines.push(
                i18n("workload-forecast-tooltip-scenario-plus", { value: f(point.scenarios.plus) })
            )
        return lines
    }
    if (point.preliminary)
        return [
            dayLabel(point.day),
            i18n("workload-forecast-tooltip-mean", { value: f(point.mean) }),
        ]
    if (point.estimatedRange) {
        return [
            dayLabel(point.day),
            i18n("workload-forecast-tooltip-mean", { value: f(point.mean) }),
            i18n("workload-forecast-tooltip-estimate", {
                low: f(point.estimatedRange.low),
                high: f(point.estimatedRange.high),
            }),
        ]
    }
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
    metric: ForecastMetric,
    horizon?: number
) {
    clearChart(svg)
    tooltipShown.set(false)
    if (!points.length) return
    const { width, height } = comparisonGraphBounds()
    const first = d3.min(points, (p) => p.day)!
    const last = d3.max(points, (p) => p.day)!
    const x = d3
        .scaleLinear()
        .domain([first, Math.max(last, first + 1, (horizon ?? 1) - 1)])
        .range([0, width])
    const scenario = !!points[0].scenarios
    const preliminary = !!points[0].preliminary
    const approximate = !!points[0].estimatedRange
    const top =
        d3.max(points, (p) =>
            Math.max(
                p.mean,
                p.scenarios?.minus ?? 0,
                p.scenarios?.plus ?? 0,
                p.estimatedRange?.high ?? (scenario ? 0 : p.p99)
            )
        ) || 1
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

    const area = (
        low: (p: ForecastPoint) => number,
        high: (p: ForecastPoint) => number,
        defined: (p: ForecastPoint) => boolean = () => true
    ) =>
        d3
            .area<ForecastPoint>()
            .defined(defined)
            .x((p) => x(p.day))
            .y0((p) => y(low(p)))
            .y1((p) => y(high(p)))
            .curve(d3.curveMonotoneX)(points)
    const line = (
        value: (p: ForecastPoint) => number,
        defined: (p: ForecastPoint) => boolean = () => true
    ) =>
        d3
            .line<ForecastPoint>()
            .defined(defined)
            .x((p) => x(p.day))
            .y((p) => y(value(p)))
            .curve(d3.curveMonotoneX)(points)
    if (scenario) {
        const minus = (p: ForecastPoint) => p.scenarios?.minus ?? p.mean
        const plus = (p: ForecastPoint) => p.scenarios?.plus ?? p.mean
        chart
            .append("path")
            .attr("class", "workload-forecast-scenario-band")
            .attr(
                "d",
                area(
                    (p) => Math.min(minus(p), plus(p)),
                    (p) => Math.max(minus(p), plus(p)),
                    (p) => p.scenarios?.minus !== undefined && p.scenarios?.plus !== undefined
                )
            )
            .attr("fill", COLOUR)
            .attr("fill-opacity", 0.2)
        for (const [name, value, dash] of [
            ["minus", minus, "5 3"],
            ["plus", plus, "2 3"],
        ] as const) {
            chart
                .append("path")
                .attr("class", `workload-forecast-scenario-${name}`)
                .attr(
                    "d",
                    line(value, (p) => p.scenarios?.[name] !== undefined)
                )
                .attr("fill", "none")
                .attr("stroke", COLOUR)
                .attr("stroke-width", 1.5)
                .attr("stroke-dasharray", dash)
        }
    } else if (!preliminary && approximate) {
        const low = (p: ForecastPoint) => p.estimatedRange?.low ?? p.mean
        const high = (p: ForecastPoint) => p.estimatedRange?.high ?? p.mean
        chart
            .append("path")
            .attr("class", "workload-forecast-estimate-band")
            .attr("d", area(low, high))
            .attr("fill", COLOUR)
            .attr("fill-opacity", 0.2)
        for (const bound of [low, high]) {
            chart
                .append("path")
                .attr("class", "workload-forecast-estimate-bound")
                .attr("d", line(bound))
                .attr("fill", "none")
                .attr("stroke", COLOUR)
                .attr("stroke-width", 1.5)
                .attr("stroke-dasharray", "5 3")
        }
    } else if (!preliminary) {
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
        chart
            .append("path")
            .attr("class", "workload-forecast-median")
            .attr(
                "d",
                line((p) => p.p50)
            )
            .attr("fill", "none")
            .attr("stroke", COLOUR)
            .attr("stroke-width", 1.5)
            .attr("stroke-dasharray", "5 3")
    }
    chart
        .append("path")
        .attr("class", "workload-forecast-mean")
        .attr(
            "d",
            line((p) => p.mean)
        )
        .attr("fill", "none")
        .attr("stroke", COLOUR)
        .attr("stroke-width", 2.5)
    if (points.length === 1) {
        chart
            .append("circle")
            .attr("cx", x(points[0].day))
            .attr("cy", y(points[0].mean))
            .attr("r", 3)
            .attr("fill", COLOUR)
    }
    if (scenario && preliminary) {
        chart
            .selectAll(".workload-forecast-scenario-spread")
            .data(
                points.filter(
                    (p) => p.scenarios?.minus !== undefined && p.scenarios?.plus !== undefined
                )
            )
            .enter()
            .append("line")
            .attr("class", "workload-forecast-scenario-spread")
            .attr("x1", (p) => x(p.day))
            .attr("x2", (p) => x(p.day))
            .attr("y1", (p) => y(p.scenarios!.minus!))
            .attr("y2", (p) => y(p.scenarios!.plus!))
            .attr("stroke", COLOUR)
            .attr("stroke-opacity", 0.5)
        for (const name of ["minus", "plus"] as const) {
            chart
                .selectAll(`.workload-forecast-scenario-point-${name}`)
                .data(points.filter((p) => p.scenarios?.[name] !== undefined))
                .enter()
                .append("circle")
                .attr("class", `workload-forecast-scenario-point-${name}`)
                .attr("cx", (p) => x(p.day))
                .attr("cy", (p) => y(p.scenarios![name]!))
                .attr("r", 2)
                .attr("fill", COLOUR)
        }
    }

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
