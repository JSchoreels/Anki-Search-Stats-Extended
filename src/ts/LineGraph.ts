import * as d3 from "d3"
import { boundedZoom, selectedZoomRange, type ZoomRange } from "./dragZoom"
import { clearChart, defaultGraphBounds } from "./graph"
import { day_ms } from "./revlogGraphs"
import { tooltip, tooltipShown } from "./stores"
import { tooltipX } from "./tooltip"
import {
    selectableTrendLine,
    type DrawnTrend,
    type InitialTrend,
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
    opacity?: number
    strokeWidth?: number
    strokeDasharray?: string
    renderOrder?: number
    legend?: boolean
}

let nextClipId = 0

/** Percentile of visible daily maxima, so the same days fit across named series. */
export function lineChartPercentileCeiling(
    series: LineChartSeries[],
    start: number,
    end: number,
    percentile: number
) {
    if (!(Number.isFinite(percentile) && percentile > 0 && percentile <= 100))
        throw new Error("Invalid line chart percentile")
    const maxima: number[] = []
    for (let day = start; day <= end; day++) {
        let maximum: number | undefined
        for (const item of series) {
            const value = item.data[day]
            if (Number.isFinite(value) && (maximum === undefined || value > maximum))
                maximum = value
        }
        if (maximum !== undefined) maxima.push(maximum)
    }
    return Math.max(1, d3.quantile(maxima, percentile / 100) ?? 0)
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
        zoomRange = undefined,
        onZoom = undefined,
        initialTrends = [],
        bounds = undefined,
        formatY = undefined,
        showIsolatedPoints = false,
        yPercentile = undefined,
        includeNegative = false,
    }: {
        onTrendsChange?: (trends: DrawnTrend[]) => void
        onPreviewTrendChange?: (trend: TrendLine) => void
        onControllerReady?: (controller: TrendSelectionController) => void
        initialPinnedTrends?: TrendRange[]
        onPinnedRangesChange?: (ranges: TrendRange[]) => void
        series?: LineChartSeries[]
        dayRange?: { start: number; end: number }
        zoomRange?: ZoomRange
        onZoom?: (range: ZoomRange) => void
        initialTrends?: InitialTrend[]
        bounds?: { width: number; height: number; marginLeft?: number }
        formatY?: (value: number) => string
        showIsolatedPoints?: boolean
        yPercentile?: number
        includeNegative?: boolean
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
    const marginLeft = bounds?.marginLeft ?? 40

    const chartSeries =
        series && series.length > 0 ? series : [{ label, data: values, color: "steelblue" }]
    const first_non_zero_indexes = chartSeries
        .map((item) =>
            item.data.findIndex(
                (value) => Number.isFinite(value) && (includeNegative || value !== 0)
            )
        )
        .filter((index) => index >= 0)
    const first_non_zero_index = d3.min(first_non_zero_indexes) ?? -1
    const domain = boundedZoom(zoomRange, {
        start: dayRange?.start ?? (first_non_zero_index === -1 ? 0 : first_non_zero_index),
        end: dayRange?.end ?? Math.max(...chartSeries.map((item) => item.data.length)) - 1,
    })
    const start_index = domain.start

    const seriesData = chartSeries.map((item) => ({
        ...item,
        points: Array.from(item.data)
            .slice(start_index, domain.end + 1)
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

    const lastDay = d3.max(allPoints.map((point) => point.day)) ?? start_index
    const capped = yPercentile !== undefined && yPercentile < 100
    const finiteValues = allPoints
        .map((point) => point.value)
        .filter((value) => Number.isFinite(value))
    let yMax = capped
        ? lineChartPercentileCeiling(chartSeries, start_index, lastDay, yPercentile)
        : Math.max(dayRange && !includeNegative ? 1 : 0, d3.max(finiteValues) || 0)
    const yMin = includeNegative ? Math.min(0, d3.min(finiteValues) || 0) : 0
    if (yMax === yMin) yMax = yMin === 0 ? 1 : 0

    const y = d3.scaleLinear().domain([yMax, yMin]).range([0, height])
    if (!capped) y.nice()

    const axis = d3
        .select(svg)
        .attr("viewBox", `-${marginLeft} -10 ${width + marginLeft + 10} ${height + 50}`)
        .append("g")

    const tickCount = bounds ? Math.max(2, Math.min(7, Math.floor(width / 90))) : 7
    gridLines(axis, x.ticks(tickCount).map(x), y.ticks().map(y), { width, height })
    if (includeNegative && yMin < 0 && yMax > 0) {
        axis.append("line")
            .attr("class", "line-zero")
            .attr("x1", 0)
            .attr("x2", width)
            .attr("y1", y(0))
            .attr("y2", y(0))
            .attr("stroke", "currentColor")
            .attr("opacity", 0.3)
    }

    const yAxis = d3.axisLeft(y)
    if (formatY) yAxis.tickFormat((value) => formatY(Number(value)))
    axis.append("g").call(yAxis).attr("opacity", 0.5)

    axis.append("g")
        .attr("transform", `translate(0, ${height})`)
        .attr("opacity", 0.5)
        .call(d3.axisBottom(x).ticks(tickCount))

    const plot = axis.append("g").attr("class", "line-plot")
    if (capped) {
        const clipId = `sse-line-clip-${nextClipId++}`
        d3.select(svg)
            .append("defs")
            .append("clipPath")
            .attr("id", clipId)
            .append("rect")
            .attr("width", width)
            .attr("height", height)
        plot.attr("clip-path", `url(#${clipId})`)
    }

    const renderedSeriesData = [...seriesData].sort(
        (left, right) => (left.renderOrder ?? 0) - (right.renderOrder ?? 0)
    )
    plot.selectAll("path.line-series")
        .data(renderedSeriesData)
        .join("path")
        .attr("class", "line-series")
        .attr("fill", "none")
        .attr("stroke", (item) => item.color)
        .attr("stroke-width", (item) => item.strokeWidth ?? 1.5)
        .attr("stroke-dasharray", (item) => item.strokeDasharray ?? null)
        .attr("opacity", (item) => item.opacity ?? 1)
        .style("pointer-events", "none")
        .attr("d", (item) =>
            d3
                .line<LineChartPoint>()
                .defined((point) => Number.isFinite(point.value))
                .x((d) => x(d.date))
                .y((d) => y(d.value))(item.points)
        )

    const legendSeries = seriesData.filter((item) => item.legend !== false)
    if (legendSeries.length > 1) {
        const legend = axis
            .append("g")
            .attr("transform", `translate(${Math.max(0, width - 130)}, 8)`)
            .style("font-size", "11px")
        const items = legend
            .selectAll("g")
            .data(legendSeries)
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

    if (showIsolatedPoints || domain.start === domain.end) {
        for (const item of renderedSeriesData) {
            plot.append("g")
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
                .attr("opacity", item.opacity ?? 1)
        }
    }

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
        chart: { svg: plot, y },
        points: date_values.map((value) => ({ x: value.day, y: value.value })),
        visibleRange: visibleTrendRangeFromLinePoints(date_values),
        hoverAreas: hoverBars,
        hoverToRange: (datum) => ({ startX: datum.day, endX: datum.day }),
        xToPixel: (day) => x(new Date(day * day_ms)),
        onTrendsChange,
        onPreviewTrendChange,
        onControllerReady,
        initialPinnedTrends,
        initialTrends,
        onPinnedRangesChange,
        drawDefaultTrend: false,
    })

    axis.on("mouseover", () => tooltipShown.set(true)).on("mouseleave", () =>
        tooltipShown.set(false)
    )

    if (onZoom && domain.end > domain.start)
        return {
            width,
            height,
            onSelect: (start: number, end: number) => onZoom(selectedZoomRange(domain, start, end)),
        }
}
