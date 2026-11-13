import * as d3 from "d3"
import type { AveragingMode } from "./dailyMovingAverage"
import {
    dailyPredictionAverage,
    dailyPredictionValue,
    type DailyPredictionDisplayMetric,
    type DailyPredictionPoint,
    type DailyPredictionWindowValue,
} from "./dailyPredictionData"
import { boundedZoom, selectedZoomRange, type ZoomRange } from "./dragZoom"
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
let nextClipId = 0

function formatMetricValue(value: number | null, metric: DailyPredictionDisplayMetric) {
    if (value === null) return i18n("daily-prediction-gap-unavailable")
    const decimals = metric === "rawGap" ? 1 : 3
    return (Math.abs(value) < 0.5 * 10 ** -decimals ? 0 : value).toFixed(decimals)
}

export function dailyPredictionTooltip(
    point: DailyPredictionPoint,
    metric: DailyPredictionDisplayMetric
) {
    const value = dailyPredictionValue(point, metric)
    return [
        dateLabel(point.day),
        i18n(`daily-prediction-${metric}-value`, {
            value: formatMetricValue(value, metric),
        }),
        i18n(
            point.actualCount === undefined
                ? "daily-prediction-actual"
                : "daily-prediction-actual-all",
            {
                value: (point.actualRecall * 100).toFixed(1),
                ...(point.actualCount === undefined ? {} : { count: point.actualCount }),
            }
        ),
        i18n(
            point.actualCount === undefined
                ? "daily-prediction-predicted"
                : "daily-prediction-average-predicted",
            { value: (point.predictedRecall * 100).toFixed(1) }
        ),
        i18n(
            point.actualCount === undefined
                ? "daily-prediction-count"
                : "daily-prediction-prediction-count",
            {
                count: point.count,
            }
        ),
    ]
}

export type DailyPredictionSeries = {
    model: string
    data: DailyPredictionPoint[]
    label?: string
    color?: string
    dashed?: boolean
}

export type SelectedDailyPredictionSeries = DailyPredictionSeries & {
    predictions: Float64Array | null
}

type DailyPredictionAverageOptions = {
    mode?: AveragingMode
    reviewValues?: Record<string, DailyPredictionWindowValue[]>
    connectGaps?: boolean
}

export function renderDailyPredictionGraph(
    svg: SVGElement,
    series: DailyPredictionSeries[],
    metric: DailyPredictionDisplayMetric,
    averageDays: number | null = null,
    zoomRange?: ZoomRange,
    onZoom?: (range: ZoomRange) => void,
    { mode = "calendar", reviewValues, connectGaps = false }: DailyPredictionAverageOptions = {}
) {
    clearChart(svg)
    tooltipShown.set(false)
    const allData = series.flatMap((item) => item.data)
    if (!allData.length) return
    const domain = boundedZoom(zoomRange, {
        start: d3.min(allData, (point) => point.day)!,
        end: d3.max(allData, (point) => point.day)!,
    })
    const data = allData.filter((point) => point.day >= domain.start && point.day <= domain.end)
    const windowLabel =
        averageDays === null
            ? ""
            : i18n(
                  mode === "reviews"
                      ? "averaging-review-window"
                      : mode === "study"
                        ? "averaging-study-window"
                        : "averaging-calendar-window",
                  { count: averageDays }
              )
    const prepared = series
        .filter((item) => item.data.length)
        .map((item) => {
            const byDay = new Map(
                reviewValues?.[item.model]?.map((point) => [point.day, point.value])
            )
            return {
                ...item,
                color:
                    item.color ??
                    (item.model === "fsrs" ? FSRS_COMPARISON_COLOUR : RWKV_COMPARISON_COLOUR),
                average:
                    averageDays === null
                        ? null
                        : mode === "reviews"
                          ? item.data.map((point) => byDay.get(point.day) ?? null)
                          : dailyPredictionAverage(item.data, metric, averageDays, mode),
            }
        })

    const { width, height } = comparisonGraphBounds()
    const firstDay = domain.start
    const lastDay = domain.end
    // Day indices already account for Anki's rollover; UTC keeps their calendar labels intact.
    const x = d3
        .scaleUtc()
        .domain([new Date((firstDay - 0.5) * day_ms), new Date((lastDay + 0.5) * day_ms)])
        .range([0, width])
    const visibleAverages = prepared.flatMap(
        (item) =>
            item.average?.filter(
                (_value, index) =>
                    item.data[index].day >= firstDay && item.data[index].day <= lastDay
            ) ?? []
    )
    const magnitude =
        (metric === "rawGap"
            ? averageDays === null
                ? d3.quantile(data, 0.95, (point) => Math.abs(dailyPredictionValue(point, metric)!))
                : (d3.max(visibleAverages, (value) => Math.abs(value ?? 0)) ?? 0) * 1.05
            : Math.max(
                  d3.max(data, (point) => Math.abs(dailyPredictionValue(point, metric) ?? 0)) || 0,
                  d3.max(visibleAverages, (value) => Math.abs(value ?? 0)) || 0
              )) || 1
    const y = d3
        .scaleLinear()
        .domain(metric === "logLoss" ? [0, magnitude] : [-magnitude, magnitude])
        .range([height, 0])
    if (metric !== "rawGap") y.nice()
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

    let clipId: string | undefined
    if (metric === "rawGap") {
        clipId = `sse-daily-prediction-clip-${nextClipId++}`
        d3.select(svg)
            .append("defs")
            .append("clipPath")
            .attr("id", clipId)
            .append("rect")
            .attr("width", width)
            .attr("height", height)
    }

    const hoverByDay = new Map<number, string[]>()
    for (const item of prepared) {
        const group = chart
            .append("g")
            .attr("data-model", item.model)
            .attr("clip-path", clipId ? `url(#${clipId})` : null)
        const modelLabel = item.label ?? i18n(`calibration-source-${item.model}`)
        const line = d3
            .line<{ day: number; value: number | null }>()
            .defined((point) => point.value !== null)
            .x((point) => x(new Date(point.day * day_ms)))
            .y((point) => y(point.value!))
        const points: { day: number; value: number | null; average: number | null }[] = []
        item.data.forEach((point, index) => {
            if (point.day < firstDay || point.day > lastDay) return
            if (index && point.day > item.data[index - 1].day + 1) {
                points.push({ day: point.day - 1, value: null, average: null })
            }
            const average = item.average?.[index] ?? null
            points.push({ day: point.day, value: dailyPredictionValue(point, metric), average })
            const text = hoverByDay.get(point.day) ?? [dateLabel(point.day)]
            text.push(modelLabel, ...dailyPredictionTooltip(point, metric).slice(1))
            if (item.average) {
                const value = formatMetricValue(average, metric)
                text.push(
                    mode === "calendar"
                        ? i18n(
                              metric === "rawGap"
                                  ? "daily-prediction-rawGap-average-value"
                                  : "daily-prediction-average-value",
                              { days: averageDays!, value }
                          )
                        : i18n(metric === "rawGap" ? "averaging-raw-value" : "averaging-value", {
                              window: windowLabel,
                              value,
                          })
                )
            }
            hoverByDay.set(point.day, text)
        })
        group
            .append("path")
            .attr("class", "daily-prediction-series")
            .attr("fill", "none")
            .attr("stroke", item.average ? "#888" : item.color)
            .attr("opacity", item.average ? 0.35 : 1)
            .attr("stroke-width", 1.5)
            .attr(
                "stroke-dasharray",
                (item.dashed ?? item.model === "rwkv") && item.average ? "3 3" : null
            )
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
            if (connectGaps) {
                const available = averaged.filter((point) => point.value !== null)
                const bridges = available.flatMap((point, index) =>
                    index && point.day > available[index - 1].day + 1
                        ? [[available[index - 1], point]]
                        : []
                )
                group
                    .selectAll("path.daily-prediction-average-gap")
                    .data(bridges)
                    .join("path")
                    .attr("class", "daily-prediction-average-gap")
                    .attr("fill", "none")
                    .attr("stroke", item.color)
                    .attr("stroke-width", 2.4)
                    .attr("stroke-dasharray", "2 4")
                    .attr("opacity", 0.65)
                    .attr("d", (bridge) => line(bridge))
            }
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
        const label = item.label ?? i18n(`calibration-source-${item.model}`)
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
                    ? label
                    : mode === "calendar"
                      ? i18n("daily-prediction-average-series", {
                            label,
                            days: averageDays,
                        })
                      : i18n("averaging-series", {
                            label,
                            window: windowLabel,
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

    if (onZoom && lastDay > firstDay)
        return {
            width,
            height,
            onSelect: (start: number, end: number) =>
                onZoom(selectedZoomRange(domain, start, end, true)),
        }
}
