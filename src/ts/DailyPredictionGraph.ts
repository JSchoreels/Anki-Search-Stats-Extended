import * as d3 from "d3"
import {
    dailyPredictionAverage,
    type DailyPredictionMetric,
    type DailyPredictionPoint,
} from "./dailyPredictionData"
import {
    clearChart,
    COMPARISON_REFERENCE_COLOUR,
    comparisonGraphBounds,
    FSRS_COMPARISON_COLOUR,
    RWKV_COMPARISON_COLOUR,
} from "./graph"
import { i18n } from "./i18n"
import { gridLines } from "./LineGraph"
import { day_ms } from "./revlogGraphs"
import { tooltip, tooltipShown } from "./stores"
import { tooltipX } from "./tooltip"

const dateLabel = (day: number) => d3.utcFormat("%Y-%m-%d")(new Date(day * day_ms))

export function dailyPredictionTooltip(point: DailyPredictionPoint, metric: DailyPredictionMetric) {
    const value = point[metric]
    return [
        dateLabel(point.day),
        i18n(`daily-prediction-${metric}-value`, {
            value:
                value === null
                    ? i18n("daily-prediction-gap-unavailable")
                    : (Math.abs(value) < 0.0005 ? 0 : value).toFixed(3),
        }),
        i18n("daily-prediction-actual", { value: (point.actualRecall * 100).toFixed(1) }),
        i18n("daily-prediction-predicted", { value: (point.predictedRecall * 100).toFixed(1) }),
        i18n("daily-prediction-count", { count: point.count }),
    ]
}

export type DailyPredictionSeries = {
    model: "fsrs" | "rwkv"
    data: DailyPredictionPoint[]
}

export function renderDailyPredictionGraph(
    svg: SVGElement,
    series: DailyPredictionSeries[],
    metric: DailyPredictionMetric,
    averageDays: number | null = null
) {
    clearChart(svg)
    tooltipShown.set(false)
    const data = series.flatMap((item) => item.data)
    if (!data.length) return
    const prepared = series
        .filter((item) => item.data.length)
        .map((item) => ({
            ...item,
            color: item.model === "fsrs" ? FSRS_COMPARISON_COLOUR : RWKV_COMPARISON_COLOUR,
            average:
                averageDays === null
                    ? null
                    : dailyPredictionAverage(item.data, metric, averageDays),
        }))

    const { width, height } = comparisonGraphBounds()
    const firstDay = d3.min(data, (point) => point.day)!
    const lastDay = d3.max(data, (point) => point.day)!
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
        .attr("viewBox", `-60 -10 ${width + 75} ${height + 90}`)
        .append("g")

    gridLines(chart, xTicks.map(x), y.ticks(6).map(y), { width, height })
    chart
        .append("g")
        .attr("class", "daily-prediction-y-axis")
        .attr("opacity", 0.6)
        .call(d3.axisLeft(y).ticks(6))
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -42)
        .attr("text-anchor", "middle")
        .attr("fill", "currentColor")
        .text(i18n(`daily-prediction-${metric}-axis`))
    chart
        .append("g")
        .attr("class", "daily-prediction-x-axis")
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
        .attr("class", "daily-prediction-zero")
        .attr("x1", 0)
        .attr("x2", width)
        .attr("y1", y(0))
        .attr("y2", y(0))
        .attr("stroke", COMPARISON_REFERENCE_COLOUR)
        .attr("stroke-dasharray", "5 4")

    const hoverByDay = new Map<number, string[]>()
    for (const item of prepared) {
        const group = chart.append("g").attr("data-model", item.model)
        const modelLabel = i18n(`calibration-source-${item.model}`)
        const line = d3
            .line<{ day: number; value: number | null }>()
            .defined((point) => point.value !== null)
            .x((point) => x(new Date(point.day * day_ms)))
            .y((point) => y(point.value!))
        const points: { day: number; value: number | null; average: number | null }[] = []
        item.data.forEach((point, index) => {
            if (index && point.day > item.data[index - 1].day + 1) {
                points.push({ day: point.day - 1, value: null, average: null })
            }
            const average = item.average?.[index] ?? null
            points.push({ day: point.day, value: point[metric], average })
            const text = hoverByDay.get(point.day) ?? [dateLabel(point.day)]
            text.push(modelLabel, ...dailyPredictionTooltip(point, metric).slice(1))
            if (item.average)
                text.push(
                    i18n("daily-prediction-average-value", {
                        days: averageDays!,
                        value:
                            average === null
                                ? i18n("daily-prediction-gap-unavailable")
                                : (Math.abs(average) < 0.0005 ? 0 : average).toFixed(3),
                    })
                )
            hoverByDay.set(point.day, text)
        })
        group
            .append("path")
            .attr("class", "daily-prediction-series")
            .attr("fill", "none")
            .attr("stroke", item.average ? "#888" : item.color)
            .attr("opacity", item.average ? 0.35 : 1)
            .attr("stroke-width", 1.5)
            .attr("stroke-dasharray", item.model === "rwkv" && item.average ? "3 3" : null)
            .attr("d", line(points))
        group
            .selectAll("circle.daily-prediction-point")
            .data(points.filter((point) => point.value !== null))
            .join("circle")
            .attr("class", "daily-prediction-point")
            .attr("cx", (point) => x(new Date(point.day * day_ms)))
            .attr("cy", (point) => y(point.value!))
            .attr("r", 2.5)
            .attr("fill", item.average ? "#888" : item.color)
            .attr("opacity", item.average ? 0.35 : 1)
        if (item.average) {
            const averaged = points.map((point) => ({ day: point.day, value: point.average }))
            group
                .append("path")
                .attr("class", "daily-prediction-average")
                .attr("fill", "none")
                .attr("stroke", item.color)
                .attr("stroke-width", 2.4)
                .attr("d", line(averaged))
            group
                .selectAll("circle.daily-prediction-average-point")
                .data(
                    averaged.filter(
                        (point, index) =>
                            point.value !== null &&
                            averaged[index - 1]?.value == null &&
                            averaged[index + 1]?.value == null
                    )
                )
                .join("circle")
                .attr("class", "daily-prediction-average-point")
                .attr("cx", (point) => x(new Date(point.day * day_ms)))
                .attr("cy", (point) => y(point.value!))
                .attr("r", 2.5)
                .attr("fill", item.color)
        }
    }

    const legend = chart.append("g").attr("class", "daily-prediction-legend")
    prepared.forEach((item, index) => {
        const entry = legend
            .append("g")
            .attr("transform", `translate(${(index * width) / prepared.length}, ${height + 55})`)
        entry.append("line").attr("x2", 18).attr("stroke", item.color).attr("stroke-width", 2.4)
        entry
            .append("text")
            .attr("x", 24)
            .attr("y", 4)
            .attr("fill", "currentColor")
            .style("font-size", "11px")
            .text(
                averageDays === null
                    ? i18n(`calibration-source-${item.model}`)
                    : i18n("daily-prediction-average-series", {
                          label: i18n(`calibration-source-${item.model}`),
                          days: averageDays,
                      })
            )
    })
    const hoverData = [...hoverByDay]
        .sort(([left], [right]) => left - right)
        .map(([day, text]) => ({ day, text }))
    chart
        .selectAll("rect.daily-prediction-hover")
        .data(hoverData)
        .join("rect")
        .attr("class", "daily-prediction-hover")
        .attr("x", (point) => x(new Date((point.day - 0.5) * day_ms)))
        .attr("y", 0)
        .attr("width", width / (lastDay - firstDay + 1))
        .attr("height", height)
        .attr("fill", "transparent")
        .attr("tabindex", 0)
        .attr("aria-label", (point) => point.text.join(". "))
        .on("mouseover mousemove", (event: MouseEvent, point) => {
            tooltip.set({ x: tooltipX(event), y: event.pageY, text: point.text })
            tooltipShown.set(true)
        })
        .on("focus", (event: FocusEvent, point) => {
            const bounds = (event.currentTarget as SVGRectElement).getBoundingClientRect()
            tooltip.set({
                x: bounds.left + window.scrollX,
                y: bounds.top + window.scrollY,
                text: point.text,
            })
            tooltipShown.set(true)
        })
        .on("mouseleave blur", () => tooltipShown.set(false))
}
