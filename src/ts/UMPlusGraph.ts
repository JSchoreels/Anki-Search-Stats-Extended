import * as d3 from "d3"
import {
    clearChart,
    comparisonGraphBounds,
    FSRS_COMPARISON_COLOUR,
    RWKV_COMPARISON_COLOUR,
} from "./graph"
import { i18n } from "./i18n"
import { gridLines } from "./LineGraph"
import { tooltip, tooltipShown } from "./stores"
import { tooltipX } from "./tooltip"
import {
    UM_PLUS_BINS_PER_UNIT,
    UM_PLUS_SMALL_BUCKET_THRESHOLD,
    umPlusDisagreementDomain,
    umPlusErrorDomain,
    visibleUmPlusBins,
    weightedRegressionSlope,
    type UmPlusBin,
    type UmPlusData,
} from "./umPlusData"

type UmPlusSeries = {
    model: string
    color: string
    score: number
    slope: number | undefined
    error: (bin: UmPlusBin) => number
}

type UmPlusSegment = {
    from: UmPlusBin
    to: UmPlusBin
    small: boolean
}

type UmPlusGraphOptions = {
    showSmallBuckets?: boolean
}

function signedPercent(value: number, digits = 0) {
    const normalized = Math.abs(value) < 1e-12 ? 0 : value
    const percent = (normalized * 100).toFixed(digits)
    return `${normalized > 0 ? "+" : ""}${percent}%`
}

function ticksByTenth([min, max]: [number, number]) {
    const first = Math.ceil(min * 10 - 1e-10)
    const last = Math.floor(max * 10 + 1e-10)
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) =>
        Number(((first + index) / 10).toFixed(1))
    )
}

function formatSlope(slope: number | undefined) {
    if (slope === undefined) {
        return i18n("um-plus-slope-unavailable")
    }
    const normalized = Math.abs(slope) < 5e-4 ? 0 : slope
    return `${normalized > 0 ? "+" : ""}${normalized.toFixed(3)}`
}

export function renderUmPlusGraph(
    svg: SVGElement,
    data: UmPlusData,
    { showSmallBuckets = false }: UmPlusGraphOptions = {}
) {
    clearChart(svg)

    const { width, height } = comparisonGraphBounds()
    const visibleBins = visibleUmPlusBins(data.bins, showSmallBuckets)
    const xDomain = umPlusDisagreementDomain(visibleBins)
    const yDomain = umPlusErrorDomain(visibleBins)
    const x = d3.scaleLinear().domain(xDomain).range([0, width])
    const y = d3.scaleLinear().domain(yDomain).range([height, 0])
    const maxCount = d3.max(visibleBins, (bin) => bin.count) ?? 0
    const countY = d3.scaleLinear().domain([0, maxCount]).range([height, 0])
    const xTicks = ticksByTenth(xDomain)
    const yTicks = ticksByTenth(yDomain)
    const halfBin = 0.5 / UM_PLUS_BINS_PER_UNIT
    const isSmall = (bin: UmPlusBin) => bin.count < UM_PLUS_SMALL_BUCKET_THRESHOLD
    const binBounds = (bin: UmPlusBin) => {
        const center = (bin.index - UM_PLUS_BINS_PER_UNIT) / UM_PLUS_BINS_PER_UNIT
        return [
            Math.max(xDomain[0], center - halfBin),
            Math.min(xDomain[1], center + halfBin),
        ] as const
    }
    const fsrsModel = i18n("calibration-source-fsrs")
    const rwkvModel = i18n("calibration-source-rwkv")
    const segments: UmPlusSegment[] = d3.pairs(visibleBins).map(([from, to]) => ({
        from,
        to,
        small: isSmall(from) || isSmall(to),
    }))
    const series: UmPlusSeries[] = [
        {
            model: fsrsModel,
            color: FSRS_COMPARISON_COLOUR,
            score: data.fsrsScore,
            slope: weightedRegressionSlope(visibleBins, (bin) => bin.fsrsError),
            error: (bin) => bin.fsrsError,
        },
        {
            model: rwkvModel,
            color: RWKV_COMPARISON_COLOUR,
            score: data.rwkvScore,
            slope: weightedRegressionSlope(visibleBins, (bin) => bin.rwkvError),
            error: (bin) => bin.rwkvError,
        },
    ]

    const axis = d3
        .select(svg)
        .attr("viewBox", `-50 -10 ${width + 115} ${height + 60}`)
        .append("g")

    axis.append("g")
        .attr("class", "um-plus-y-axis")
        .attr("opacity", 0.5)
        .call(
            d3
                .axisLeft(y)
                .tickValues(yTicks)
                .tickFormat((value) => signedPercent(+value))
        )
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -38)
        .attr("text-anchor", "middle")
        .style("stroke", "currentColor")
        .text(i18n("um-plus-y-axis"))

    axis.append("g")
        .attr("class", "um-plus-x-axis")
        .attr("transform", `translate(0, ${height})`)
        .attr("opacity", 0.5)
        .call(
            d3
                .axisBottom(x)
                .tickValues(xTicks)
                .tickFormat((value) => signedPercent(+value))
        )
        .append("text")
        .attr("x", width / 2)
        .attr("y", 34)
        .attr("text-anchor", "middle")
        .style("stroke", "currentColor")
        .text(i18n("um-plus-x-axis"))

    axis.append("g")
        .attr("class", "um-plus-volume-axis")
        .attr("transform", `translate(${width}, 0)`)
        .attr("opacity", 0.5)
        .call(d3.axisRight(countY).ticks(4).tickFormat(d3.format("~s")))
        .append("text")
        .attr("transform", "rotate(90)")
        .attr("x", height / 2)
        .attr("y", -45)
        .attr("text-anchor", "middle")
        .style("stroke", "currentColor")
        .text(i18n("um-plus-volume-axis"))

    axis.append("g")
        .attr("class", "um-plus-volume")
        .selectAll("rect")
        .data(visibleBins)
        .join("rect")
        .attr("class", (bin) => `um-plus-volume-bar${isSmall(bin) ? " um-plus-small-bucket" : ""}`)
        .attr("x", (bin) => x(binBounds(bin)[0]))
        .attr("width", (bin) => x(binBounds(bin)[1]) - x(binBounds(bin)[0]))
        .attr("y", (bin) => countY(bin.count))
        .attr("height", (bin) => height - countY(bin.count))
        .attr("fill", "currentColor")
        .attr("opacity", (bin) => (isSmall(bin) ? 0.04 : 0.12))

    gridLines(axis, xTicks.map(x), yTicks.map(y), { width, height })

    axis.append("line")
        .attr("x1", 0)
        .attr("x2", width)
        .attr("y1", y(0))
        .attr("y2", y(0))
        .attr("stroke", "currentColor")
        .attr("stroke-width", 1.5)

    if (xDomain[0] <= 0 && xDomain[1] >= 0) {
        axis.append("line")
            .attr("class", "um-plus-zero-disagreement")
            .attr("x1", x(0))
            .attr("x2", x(0))
            .attr("y1", 0)
            .attr("y2", height)
            .attr("stroke", "currentColor")
            .attr("opacity", 0.35)
    }

    for (const item of series) {
        axis.append("g")
            .attr("class", "um-plus-series")
            .attr("data-model", item.model)
            .selectAll("line")
            .data(segments)
            .join("line")
            .attr(
                "class",
                (segment) => `um-plus-series-segment${segment.small ? " um-plus-small-bucket" : ""}`
            )
            .attr("x1", (segment) => x(segment.from.disagreement))
            .attr("x2", (segment) => x(segment.to.disagreement))
            .attr("y1", (segment) => y(item.error(segment.from)))
            .attr("y2", (segment) => y(item.error(segment.to)))
            .attr("stroke", item.color)
            .attr("stroke-width", 1.5)
            .attr("stroke-dasharray", (segment) => (segment.small ? "3 3" : null))
            .attr("opacity", (segment) => (segment.small ? 0.35 : 1))
    }

    const pointRadius = (bin: UmPlusBin) =>
        Math.max(2.5, Math.sqrt(((bin.count / data.count) * 1024) / Math.PI))

    for (const item of series) {
        axis.append("g")
            .selectAll("circle")
            .data(visibleBins)
            .join("circle")
            .attr("class", (bin) => `um-plus-point${isSmall(bin) ? " um-plus-small-bucket" : ""}`)
            .attr("cx", (bin) => x(bin.disagreement))
            .attr("cy", (bin) => y(item.error(bin)))
            .attr("r", pointRadius)
            .attr("fill", item.color)
            .attr("opacity", (bin) => (isSmall(bin) ? 0.2 : 0.45))
    }

    const legend = axis
        .append("g")
        .attr("transform", `translate(${Math.max(0, width - 250)}, 8)`)
        .style("font-size", "11px")
    const legendItems = legend
        .selectAll("g")
        .data(series)
        .join("g")
        .attr("transform", (_item, index) => `translate(0, ${index * 16})`)
    legendItems
        .append("line")
        .attr("x1", 0)
        .attr("x2", 18)
        .attr("stroke", (item) => item.color)
        .attr("stroke-width", 2)
    legendItems
        .append("text")
        .attr("x", 24)
        .attr("y", 4)
        .style("fill", "currentColor")
        .text((item) =>
            i18n("um-plus-legend", {
                model: item.model,
                score: item.score.toFixed(4),
                slope: formatSlope(item.slope),
            })
        )

    axis.append("g")
        .selectAll("rect")
        .data(visibleBins)
        .join("rect")
        .attr("x", (bin) => x(binBounds(bin)[0]))
        .attr("width", (bin) => x(binBounds(bin)[1]) - x(binBounds(bin)[0]))
        .attr("height", height)
        .attr("fill", "transparent")
        .on("mouseover", (event: MouseEvent, bin) => {
            tooltip.set({
                x: tooltipX(event),
                y: event.pageY,
                text: [
                    i18n("um-plus-tooltip-disagreement", {
                        value: signedPercent(bin.disagreement, 1),
                    }),
                    i18n("um-plus-tooltip-error", {
                        model: fsrsModel,
                        value: signedPercent(bin.fsrsError, 1),
                    }),
                    i18n("um-plus-tooltip-error", {
                        model: rwkvModel,
                        value: signedPercent(bin.rwkvError, 1),
                    }),
                    i18n("um-plus-tooltip-volume", {
                        count: bin.count,
                        percent: ((bin.count / data.count) * 100).toFixed(1),
                    }),
                ],
            })
        })

    axis.on("mouseover", () => tooltipShown.set(true)).on("mouseleave", () =>
        tooltipShown.set(false)
    )
}
