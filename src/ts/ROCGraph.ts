import * as d3 from "d3"
import {
    clearChart,
    COMPARISON_REFERENCE_COLOUR,
    comparisonGraphBounds,
    FSRS_COMPARISON_COLOUR,
    RWKV_COMPARISON_COLOUR,
} from "./graph"
import { i18n } from "./i18n"
import { gridLines } from "./LineGraph"
import type { RocData, RocPoint, RocSeries } from "./rocData"
import { tooltip, tooltipShown } from "./stores"
import { tooltipX } from "./tooltip"

type DrawnRocSeries = RocSeries & {
    model: string
    color: string
}

const percent = (value: d3.NumberValue) => `${(+value * 100).toFixed(0)}%`

function sampledThresholds(points: RocPoint[], maximum = 200) {
    const finite = points.filter((point) => Number.isFinite(point.threshold))
    if (finite.length <= maximum) {
        return finite
    }

    const last = finite.length - 1
    return Array.from(
        { length: maximum },
        (_, index) => finite[Math.round((index * last) / (maximum - 1))]
    )
}

export function renderRocGraph(svg: SVGElement, data: RocData) {
    clearChart(svg)

    const { width, height } = comparisonGraphBounds()
    const x = d3.scaleLinear().domain([0, 1]).range([0, width])
    const y = d3.scaleLinear().domain([0, 1]).range([height, 0])
    const ticks = d3.range(0, 1.01, 0.1)
    const series: DrawnRocSeries[] = [
        {
            ...data.fsrs,
            model: i18n("calibration-source-fsrs"),
            color: FSRS_COMPARISON_COLOUR,
        },
        {
            ...data.rwkv,
            model: i18n("calibration-source-rwkv"),
            color: RWKV_COMPARISON_COLOUR,
        },
    ]

    const axis = d3
        .select(svg)
        .attr("viewBox", `-50 -10 ${width + 65} ${height + 60}`)
        .append("g")

    axis.append("g")
        .attr("class", "roc-y-axis")
        .attr("opacity", 0.5)
        .call(d3.axisLeft(y).tickValues(ticks).tickFormat(percent))
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -38)
        .attr("text-anchor", "middle")
        .style("stroke", "currentColor")
        .text(i18n("roc-y-axis"))

    axis.append("g")
        .attr("class", "roc-x-axis")
        .attr("transform", `translate(0, ${height})`)
        .attr("opacity", 0.5)
        .call(d3.axisBottom(x).tickValues(ticks).tickFormat(percent))
        .append("text")
        .attr("x", width / 2)
        .attr("y", 34)
        .attr("text-anchor", "middle")
        .style("stroke", "currentColor")
        .text(i18n("roc-x-axis"))

    gridLines(axis, ticks.map(x), ticks.map(y), { width, height })

    axis.append("line")
        .attr("class", "roc-chance-line")
        .attr("x1", x(0))
        .attr("y1", y(0))
        .attr("x2", x(1))
        .attr("y2", y(1))
        .attr("stroke", COMPARISON_REFERENCE_COLOUR)
        .attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "5 4")

    const line = d3
        .line<RocPoint>()
        .x((point) => x(point.falsePositiveRate))
        .y((point) => y(point.truePositiveRate))

    axis.selectAll("path.roc-series")
        .data(series)
        .join("path")
        .attr("class", "roc-series")
        .attr("data-model", (item) => item.model)
        .attr("fill", "none")
        .attr("stroke", (item) => item.color)
        .attr("stroke-width", 2)
        .attr("d", (item) => line(item.points))

    const legendData = [
        ...series.map((item) => ({
            label: item.interval
                ? i18n("roc-legend-interval", {
                      model: item.model,
                      auc: item.auc!.toFixed(4),
                      lower: item.interval.lower.toFixed(4),
                      upper: item.interval.upper.toFixed(4),
                  })
                : i18n("roc-legend", {
                      model: item.model,
                      auc: item.auc?.toFixed(4) ?? i18n("roc-auc-unavailable"),
                  }),
            color: item.color,
            dashed: false,
        })),
        {
            label: i18n("roc-chance-legend"),
            color: COMPARISON_REFERENCE_COLOUR,
            dashed: true,
        },
    ]
    const legend = axis
        .append("g")
        .attr("class", "roc-legend")
        // Bottom right stays below the chance diagonal, clear of curves with AUC above 0.5.
        .attr(
            "transform",
            `translate(${Math.max(0, width - 340)}, ${height - (legendData.length - 1) * 16 - 12})`
        )
        .style("font-size", "11px")
    const legendItems = legend
        .selectAll("g")
        .data(legendData)
        .join("g")
        .attr("transform", (_item, index) => `translate(0, ${index * 16})`)
    legendItems
        .append("line")
        .attr("x1", 0)
        .attr("x2", 18)
        .attr("stroke", (item) => item.color)
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", (item) => (item.dashed ? "5 4" : null))
    legendItems
        .append("text")
        .attr("x", 24)
        .attr("y", 4)
        .style("fill", "currentColor")
        .text((item) => item.label)

    const hoverPoints = series.flatMap((item) =>
        sampledThresholds(item.points).map((point) => ({ ...point, ...item }))
    )
    axis.append("g")
        .attr("class", "roc-thresholds")
        .selectAll("circle")
        .data(hoverPoints)
        .join("circle")
        .attr("cx", (point) => x(point.falsePositiveRate))
        .attr("cy", (point) => y(point.truePositiveRate))
        .attr("r", 6)
        .attr("fill", "transparent")
        .on("mouseover", (event: MouseEvent, point) => {
            tooltip.set({
                x: tooltipX(event),
                y: event.pageY,
                text: [
                    i18n("roc-tooltip-threshold", {
                        model: point.model,
                        threshold: (point.threshold * 100).toFixed(1),
                    }),
                    i18n("roc-tooltip-tpr", {
                        value: (point.truePositiveRate * 100).toFixed(1),
                    }),
                    i18n("roc-tooltip-fpr", {
                        value: (point.falsePositiveRate * 100).toFixed(1),
                    }),
                ],
            })
        })

    axis.on("mouseover", () => tooltipShown.set(true)).on("mouseleave", () =>
        tooltipShown.set(false)
    )
}
