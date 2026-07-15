import * as d3 from "d3"
import { comparisonGraphBounds } from "./graph"
import { i18n } from "./i18n"
import { gridLines } from "./LineGraph"
import type { LossBin } from "./MemorisedBar"
import { tooltip, tooltipShown } from "./stores"
import { tooltipX } from "./tooltip"

const percentify = (d: any) => `${(+d * 100).toFixed(0)}%`

export type CalibrationSeries = {
    label: string
    bins: LossBin[]
    color: string
}

function isCalibrationSeries(input: LossBin[] | CalibrationSeries[]): input is CalibrationSeries[] {
    return !!input[0] && "bins" in input[0]
}

export function fsrsCalibrationGraph(svg: SVGElement, input: LossBin[] | CalibrationSeries[]) {
    d3.select(svg).selectAll("*").remove()

    const { width, height } = comparisonGraphBounds()
    const xTicks = 10

    interface CalibrationBinData {
        bin: LossBin
        index: number
    }

    interface CalibrationHoverBinData {
        index: number
        series: {
            label: string
            datum: CalibrationBinData
        }[]
    }

    const series = isCalibrationSeries(input)
        ? input
        : [{ label: i18n("calibration-legend-fsrs"), bins: input, color: "steelblue" }]
    const binCount = d3.max(series.map((s) => s.bins.length)) ?? 0

    const x = d3.scaleLinear().domain([0, 1]).range([0, width])
    const y = d3.scaleLinear().domain([0, 1]).range([height, 0])

    function binWidth(i: number) {
        const L = Math.log(binCount + 1)
        const pLow = Math.log(i + 1) / L
        const pHigh = Math.log(i + 2) / L
        return [x(pLow), x(pHigh)] as [number, number]
    }

    const max_bin =
        d3.max(series.flatMap((s) => s.bins.map((d) => d?.count ?? 0).filter((d) => d > 0))) ?? 0

    const count_y = d3.scaleLinear().domain([0, max_bin]).range([height, 0])

    const axis = d3
        .select(svg)
        .attr("viewBox", `-40 -10 ${width + 50 + Math.log(max_bin) * 10} ${height + 50}`)
        .append("g")

    const leftAxis = axis
        .append("g")
        .attr("class", "calibration-y-axis")
        .call(d3.axisLeft(y).tickFormat(percentify))
        .attr("opacity", 0.5)

    leftAxis
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -31)
        .attr("text-anchor", "middle")
        .style("stroke", "currentColor")
        .text(i18n("actual"))

    const rightAxis = axis
        .append("g")
        .attr("class", "calibration-volume-axis")
        .attr("transform", `translate(${width}, 0)`)
        .attr("opacity", 0.5)
        .call(d3.axisRight(count_y))

    rightAxis
        .append("text")
        .attr("transform", "rotate(90)")
        .attr("x", height / 2)
        .attr("y", -55)
        .attr("text-anchor", "middle")
        .style("stroke", "currentColor")
        .text(i18n("count"))

    const bottomAxis = axis
        .append("g")
        .attr("class", "calibration-x-axis")
        .attr("transform", `translate(0, ${height})`)
        .attr("opacity", 0.5)
        .call(d3.axisBottom(x).tickFormat(percentify).ticks(xTicks))

    bottomAxis
        .append("text")
        .attr("x", width / 2)
        .attr("y", 30)
        .attr("text-anchor", "middle")
        .style("stroke", "currentColor")
        .text(i18n("predicted"))

    function normalizedData(bins: LossBin[]) {
        return bins.map(
            (d, i) =>
                // Converted to proportions
                <CalibrationBinData>{
                    bin: {
                        real: d.real / d.count,
                        predicted: d.predicted / d.count,
                        count: d.count,
                        confidenceInterval: d.confidenceInterval,
                    },
                    index: i,
                }
        )
    }

    const lineData = series.map((s) => ({ ...s, data: normalizedData(s.bins) }))
    const pointData = lineData.flatMap((s) =>
        s.data.filter((d): d is CalibrationBinData => !!d).map((d) => ({ ...d, color: s.color }))
    )
    const countBars = lineData.flatMap((s) =>
        s.data.filter((d): d is CalibrationBinData => !!d).map((d) => ({ ...d, color: s.color }))
    )
    const hoverData: CalibrationHoverBinData[] = Array.from({ length: binCount }, (_, index) => ({
        index,
        series: lineData
            .map((s) => ({ label: s.label, datum: s.data[index] }))
            .filter((d): d is { label: string; datum: CalibrationBinData } => !!d.datum),
    }))

    axis.append("g")
        .selectAll("g")
        .data(countBars)
        .join("rect")
        .attr("fill", (d) => d.color)
        .attr("opacity", lineData.length > 1 ? 0.3 : 0.5)
        .attr("height", (d) => height - count_y(d.bin.count))
        .attr("width", (d) => binWidth(d.index)[1] - binWidth(d.index)[0])
        .attr("x", (d) => binWidth(d.index)[0])
        .attr("y", (d) => count_y(d.bin.count))

    const diagonalData = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
    ]

    d3.select(svg)
        .append("path")
        .datum(diagonalData)
        .attr("fill", "none")
        .attr("stroke", "orange")
        .attr("stroke-width", 1.5)
        .style("pointer-events", "none")
        .attr(
            "d",
            d3
                .line<{ x: number; y: number }>()
                .x((d) => x(d.x))
                .y((d) => y(d.y))
        )

    d3.select(svg)
        .selectAll("path.calibration-series")
        .data(lineData)
        .join("path")
        .attr("class", "calibration-series")
        .attr("fill", "none")
        .attr("stroke", (d) => d.color)
        .attr("stroke-width", 1.5)
        .style("pointer-events", "none")
        .attr("d", (d) =>
            d3
                .line<CalibrationBinData>()
                .defined((d) => !!d)
                .x((d) => x(d.bin.predicted))
                .y((d) => y(d.bin.real))(d.data)
        )

    const confidenceIntervals = axis
        .append("g")
        .attr("class", "calibration-confidence-intervals")
        .selectAll("g")
        .data(pointData.filter((d) => !!d.bin.confidenceInterval))
        .join("g")
        .attr("transform", (d) => `translate(${x(d.bin.predicted)}, 0)`)
        .attr("stroke", (d) => d.color)
        .attr("stroke-width", 1.25)

    confidenceIntervals
        .append("line")
        .attr("y1", (d) => y(d.bin.confidenceInterval![0]))
        .attr("y2", (d) => y(d.bin.confidenceInterval![1]))

    confidenceIntervals
        .append("line")
        .attr("x1", -3)
        .attr("x2", 3)
        .attr("y1", (d) => y(d.bin.confidenceInterval![0]))
        .attr("y2", (d) => y(d.bin.confidenceInterval![0]))

    confidenceIntervals
        .append("line")
        .attr("x1", -3)
        .attr("x2", 3)
        .attr("y1", (d) => y(d.bin.confidenceInterval![1]))
        .attr("y2", (d) => y(d.bin.confidenceInterval![1]))

    confidenceIntervals
        .append("circle")
        .attr("cy", (d) => y(d.bin.real))
        .attr("r", 2.5)
        .attr("fill", (d) => d.color)
        .attr("stroke", "none")

    if (lineData.length > 0) {
        const legend = axis
            .append("g")
            .attr("transform", `translate(${width - 130}, 8)`)
            .style("font-size", "11px")

        const legendItems = legend
            .selectAll("g")
            .data(lineData)
            .join("g")
            .attr("transform", (_d, i) => `translate(0, ${i * 16})`)

        legendItems
            .append("line")
            .attr("x1", 0)
            .attr("x2", 18)
            .attr("y1", 0)
            .attr("y2", 0)
            .attr("stroke", (d) => d.color)
            .attr("stroke-width", 2)

        legendItems
            .append("text")
            .attr("x", 24)
            .attr("y", 4)
            .style("fill", "currentColor")
            .text((d) => d.label)
    }

    axis.append("g")
        .selectAll("g")
        .data(hoverData.filter((d) => d.series.length > 0))
        .join("rect")
        .attr("class", "hover-bar")
        .attr("height", height)
        .attr("width", (d) => binWidth(d.index)[1] - binWidth(d.index)[0])
        .attr("x", (d) => binWidth(d.index)[0])
        .attr("y", 0)
        .on("mouseover", (e: MouseEvent, d) => {
            const primary = d.series[0]
            const lines =
                d.series.length === 1
                    ? [
                          `${i18n("predicted")} ${(primary.datum.bin.predicted * 100).toFixed(
                              1
                          )}%:`,
                          `${i18n("actual")}: ${(primary.datum.bin.real * 100).toFixed(1)}%`,
                          ...(primary.datum.bin.confidenceInterval
                              ? [
                                    i18n("calibration-confidence-interval", {
                                        lower: (
                                            primary.datum.bin.confidenceInterval[0] * 100
                                        ).toFixed(1),
                                        upper: (
                                            primary.datum.bin.confidenceInterval[1] * 100
                                        ).toFixed(1),
                                    }),
                                ]
                              : []),
                          `${i18n("count")}: ${primary.datum.bin.count}`,
                      ]
                    : d.series.flatMap(({ label, datum }) => [
                          `${label}: ${(datum.bin.predicted * 100).toFixed(1)}% ${i18n(
                              "predicted"
                          )}`,
                          `${i18n("actual")}: ${(datum.bin.real * 100).toFixed(1)}%, ${i18n(
                              "count"
                          )}: ${datum.bin.count}`,
                          ...(datum.bin.confidenceInterval
                              ? [
                                    i18n("calibration-confidence-interval", {
                                        lower: (datum.bin.confidenceInterval[0] * 100).toFixed(1),
                                        upper: (datum.bin.confidenceInterval[1] * 100).toFixed(1),
                                    }),
                                ]
                              : []),
                      ])
            tooltip.set({
                x: tooltipX(e),
                y: e.pageY,
                text: lines,
            })
        })

    axis.on("mouseover", () => tooltipShown.set(true)).on("mouseleave", () =>
        tooltipShown.set(false)
    )

    gridLines(axis, x.ticks(xTicks).map(x), y.ticks().map(y), { width, height })
}
