import * as d3 from "d3"
import { clearChart, defaultGraphBounds } from "./graph"
import { day_ms } from "./revlogGraphs"
import { tooltip, tooltipShown } from "./stores"
import { tooltipX } from "./tooltip"
import {
    selectableTrendLine,
    type DrawnTrend,
    type TrendLine,
    type TrendRange,
    type TrendSelectionController,
} from "./trend"

export function gridLines(
    svg: d3.Selection<SVGGElement, unknown, null, undefined>,
    xTicks: number[],
    yTicks: number[],
    bounds: Pick<ReturnType<typeof defaultGraphBounds>, "width" | "height"> = defaultGraphBounds()
) {
    const { width, height } = bounds

    svg.append("g")
        .attr("class", "grid-lines-x")
        .selectAll("line")
        .data(xTicks)
        .join("line")
        .attr("x1", (d) => d)
        .attr("x2", (d) => d)
        .attr("y1", 0)
        .attr("y2", height)
        .style("stroke", "currentColor")
        .style("opacity", 0.05)

    svg.append("g")
        .attr("class", "grid-lines-y")
        .selectAll("line")
        .data(yTicks)
        .join("line")
        .attr("x1", 0)
        .attr("x2", width)
        .attr("y1", (d) => d)
        .attr("y2", (d) => d)
        .attr("stroke", "currentColor")
        .style("opacity", 0.05)
}

type LineChartPoint = { value: number; date: Date; day: number }

export type LineChartSeries = {
    label: string
    data: number[]
    color: string
}

export function visibleTrendRangeFromLinePoints(points: Pick<LineChartPoint, "day">[]) {
    if (!points.length) {
        return
    }
    const days = points.map((point) => point.day)
    const minDay = d3.min(days)
    const maxDay = d3.max(days)
    if (minDay === undefined || maxDay === undefined) {
        return
    }
    return { startX: minDay, endX: maxDay }
}

export function renderLineChart(
    svg: SVGElement,
    values: number[],
    label = "Value",
    {
        onTrendsChange = () => {},
        onPreviewTrendChange = () => {},
        onControllerReady = () => {},
        initialPinnedTrends = [],
        onPinnedRangesChange = () => {},
        series = undefined,
        dayRange = undefined,
        bounds = undefined,
        formatY = undefined,
        showIsolatedPoints = false,
    }: {
        onTrendsChange?: (trends: DrawnTrend[]) => void
        onPreviewTrendChange?: (trend: TrendLine) => void
        onControllerReady?: (controller: TrendSelectionController) => void
        initialPinnedTrends?: TrendRange[]
        onPinnedRangesChange?: (ranges: TrendRange[]) => void
        series?: LineChartSeries[]
        dayRange?: { start: number; end: number }
        bounds?: { width: number; height: number }
        formatY?: (value: number) => string
        showIsolatedPoints?: boolean
    } = {}
) {
    if (!svg) {
        onTrendsChange([])
        onPreviewTrendChange(undefined)
        onControllerReady({
            removeTrend: () => {},
            togglePin: () => {},
            toggleMode: () => {},
            updateRange: () => {},
            clear: () => {},
        })
        return
    }
    // This is a hacky fix and I should probably fix the d3 calls below instead
    clearChart(svg)
    const { width, height } = bounds ?? defaultGraphBounds()

    const chartSeries =
        series && series.length > 0 ? series : [{ label, data: values, color: "steelblue" }]
    const first_non_zero_indexes = chartSeries
        .map((item) => item.data.findIndex((value) => value))
        .filter((index) => index >= 0)
    const first_non_zero_index = d3.min(first_non_zero_indexes) ?? -1
    const start_index = dayRange?.start ?? (first_non_zero_index === -1 ? 0 : first_non_zero_index)

    const seriesData = chartSeries.map((item) => ({
        ...item,
        points: Array.from(item.data)
            .slice(start_index, dayRange ? dayRange.end + 1 : undefined)
            .map((value, index) => ({
                value: value ?? 0,
                date: new Date((start_index + index) * day_ms),
                day: start_index + index,
            })),
    }))
    const date_values = seriesData.find((item) => item.points.length > 0)?.points ?? []

    if (!date_values.length) {
        onTrendsChange([])
        onPreviewTrendChange(undefined)
        onControllerReady({
            removeTrend: () => {},
            togglePin: () => {},
            toggleMode: () => {},
            updateRange: () => {},
            clear: () => {},
        })
        return
    }

    const allPoints = seriesData.flatMap((item) => item.points)
    const xMin = d3.min(allPoints.map((d) => d.date))!
    const xMax = d3.max(allPoints.map((d) => d.date))!

    const x = d3.scaleTime().domain([xMin, xMax]).range([0, width])

    const yMax = Math.max(dayRange ? 1 : 0, d3.max(allPoints.map((point) => point.value)) || 0)

    const y = d3.scaleLinear().domain([yMax, 0]).range([0, height]).nice()

    const axis = d3
        .select(svg)
        .attr("viewBox", `-40 -10 ${width + 50} ${height + 50}`)
        .append("g")

    const tickCount = bounds ? Math.max(2, Math.min(7, Math.floor(width / 90))) : 7
    gridLines(axis, x.ticks(tickCount).map(x), y.ticks().map(y), { width, height })

    const yAxis = d3.axisLeft(y)
    if (formatY) yAxis.tickFormat((value) => formatY(Number(value)))
    axis.append("g").call(yAxis).attr("opacity", 0.5)

    axis.append("g")
        .attr("transform", `translate(0, ${height})`)
        .attr("opacity", 0.5)
        .call(d3.axisBottom(x).ticks(tickCount))

    d3.select(svg)
        .selectAll("path.line-series")
        .data(seriesData)
        .join("path")
        .attr("class", "line-series")
        .attr("fill", "none")
        .attr("stroke", (item) => item.color)
        .attr("stroke-width", 1.5)
        .style("pointer-events", "none")
        .attr("d", (item) =>
            d3
                .line<LineChartPoint>()
                .defined((point) => Number.isFinite(point.value))
                .x((d) => x(d.date))
                .y((d) => y(d.value))(item.points)
        )

    if (seriesData.length > 1) {
        const legend = axis
            .append("g")
            .attr("transform", `translate(${Math.max(0, width - 130)}, 8)`)
            .style("font-size", "11px")
        const items = legend
            .selectAll("g")
            .data(seriesData)
            .join("g")
            .attr("transform", (_item, index) => `translate(0, ${index * 16})`)
        items
            .append("line")
            .attr("x1", 0)
            .attr("x2", 16)
            .attr("y1", 0)
            .attr("y2", 0)
            .attr("stroke", (item) => item.color)
            .attr("stroke-width", 2)
        items
            .append("text")
            .attr("x", 22)
            .attr("y", 3)
            .attr("fill", "currentColor")
            .text((item) => item.label)
    }

    if (showIsolatedPoints) {
        for (const item of seriesData) {
            axis.append("g")
                .selectAll("circle")
                .data(
                    item.points.filter(
                        (point, index, points) =>
                            Number.isFinite(point.value) &&
                            !Number.isFinite(points[index - 1]?.value) &&
                            !Number.isFinite(points[index + 1]?.value)
                    )
                )
                .join("circle")
                .attr("class", "line-isolated-point")
                .attr("cx", (point) => x(point.date))
                .attr("cy", (point) => y(point.value))
                .attr("r", 2.5)
                .attr("fill", item.color)
        }
    }

    const lastDay = d3.max(allPoints.map((point) => point.day)) ?? start_index
    const hoverData = Array.from({ length: lastDay - start_index + 1 }, (_, index) => {
        const day = start_index + index
        return {
            day,
            date: new Date(day * day_ms),
            values: seriesData.map((item) => ({
                label: item.label,
                value: item.data[day],
            })),
        }
    })
    const bar_width = width / hoverData.length + 1
    const hoverBars = axis
        .append("g")
        .selectAll<SVGRectElement, (typeof hoverData)[number]>("rect")
        .data(hoverData)
        .join("rect")
        .attr("class", "hover-bar")
        .attr("height", height)
        .attr("width", (_, i) => (i > 0 ? bar_width : bar_width / 2))
        .attr("x", (d, i) => x(d.date)! - (i > 0 ? bar_width / 2 : 0))
        .attr("y", 0)
        .on("mouseover", (e: MouseEvent, d) => {
            tooltip.set({
                x: tooltipX(e),
                y: e.pageY,
                text: [
                    `${d.date.toLocaleDateString()}:`,
                    ...d.values
                        .filter((item) => Number.isFinite(item.value))
                        .map((item) => {
                            const value = item.value
                            const rendered = formatY
                                ? formatY(value)
                                : value > 10
                                  ? value.toFixed(0)
                                  : value.toPrecision(2)
                            return `${item.label}: ${rendered}`
                        }),
                ],
            })
        })

    selectableTrendLine({
        chart: { svg: axis, y },
        points: date_values.map((value) => ({ x: value.day, y: value.value })),
        visibleRange: visibleTrendRangeFromLinePoints(date_values),
        hoverAreas: hoverBars,
        hoverToRange: (datum) => ({ startX: datum.day, endX: datum.day }),
        xToPixel: (day) => x(new Date(day * day_ms)),
        onTrendsChange,
        onPreviewTrendChange,
        onControllerReady,
        initialPinnedTrends,
        onPinnedRangesChange,
        drawDefaultTrend: false,
    })

    axis.on("mouseover", () => tooltipShown.set(true)).on("mouseleave", () =>
        tooltipShown.set(false)
    )
}
