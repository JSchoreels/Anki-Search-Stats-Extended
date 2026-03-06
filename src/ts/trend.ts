import type { Pattern } from "@fluent/bundle/esm/ast"
import * as d3 from "d3"
import _ from "lodash"
import createTrend from "trendline"
import type { ExtraRenderInput } from "./bar"
import type { StoredTrendCoordinate, StoredTrendMode, StoredTrendRange } from "./config"
export type { StoredTrendCoordinate, StoredTrendMode, StoredTrendRange } from "./config"

export type TrendInfo = Partial<{
    pattern: Pattern
    positivePattern: Pattern
    negativePattern: Pattern
    percentage: boolean
    absolute: boolean
}>

export type TrendModel = ReturnType<typeof createTrend>
export type TrendLine = TrendModel | undefined
export type TrendMode = StoredTrendMode
export type TrendDatum = {
    x: number
    y: number
    rangeStart?: number
    rangeEnd?: number
}

export type DrawnTrend = {
    id: number
    colour: string
    trend: TrendModel
    startX: number
    endX: number
    storedStartX?: StoredTrendCoordinate
    storedEndX?: StoredTrendCoordinate
    pinned: boolean
    kind: "default" | "custom"
    mode: TrendMode
}

export type TrendRange = {
    startX: number
    endX: number
    storedStartX?: StoredTrendCoordinate
    storedEndX?: StoredTrendCoordinate
    mode?: TrendMode
}

export type InitialTrend = Pick<
    DrawnTrend,
    "startX" | "endX" | "storedStartX" | "storedEndX" | "colour" | "pinned" | "kind" | "mode"
>

type TrendClickTransition = {
    nextAnchorX: number | undefined
    range?: TrendRange
}

type TrendCancelTransition = {
    nextAnchorX: number | undefined
    clearPreview: boolean
}

type TrendSelectionOptions<T> = {
    chart: Pick<ExtraRenderInput<unknown>, "svg" | "y">
    points: TrendDatum[]
    visibleRange?: TrendRange
    hoverAreas: d3.Selection<SVGRectElement, T, SVGGElement, unknown>
    hoverToRange: (datum: T) => TrendRange
    xToPixel: (x: number) => number | undefined
    onTrendsChange?: (trends: DrawnTrend[]) => void
    onPreviewTrendChange?: (trend: TrendLine) => void
    onControllerReady?: (controller: TrendSelectionController) => void
    initialPinnedTrends?: TrendRange[]
    initialTrends?: InitialTrend[]
    onPinnedRangesChange?: (ranges: TrendRange[]) => void
    drawDefaultTrend?: boolean
}

type HoverTarget = {
    range: TrendRange
    centerX: number
}

export type TrendSelectionController = {
    removeTrend: (id: number) => void
    togglePin: (id: number) => void
    toggleMode: (id: number) => void
    updateRange: (id: number, range: TrendRange) => void
    clear: () => void
}

export type TrendSelectionState = {
    visibleTrends: DrawnTrend[]
    previewTrend: TrendLine
    removeTrend: (id: number) => void
    togglePinTrend: (id: number) => void
    toggleTrendMode: (id: number) => void
    updateTrendRange: (id: number, range: TrendRange) => void
}

export function emptyTrendSelectionState(): TrendSelectionState {
    return {
        visibleTrends: [],
        previewTrend: undefined,
        removeTrend: () => {},
        togglePinTrend: () => {},
        toggleTrendMode: () => {},
        updateTrendRange: () => {},
    }
}

const trendColours = ["#e63946", "#1d3557", "#2a9d8f", "#f4a261", "#6a4c93", "#457b9d"]
const trendColoursNight = ["#ff9aa2", "#a9def9", "#b8f2e6", "#ffd6a5", "#d0bfff", "#bde0fe"]
export const DEFAULT_TREND_COLOUR = "#000000"
export const DEFAULT_TREND_MODE: TrendMode = "fitted"
export const LIKELY_TIMESTAMP_MS_MIN = 10_000_000_000
export const PREVIEW_TREND_LINE_DASH = "4 2"
export const FIXED_TREND_LINE_DASH = "none"

function isValidTrendDatum(datum: TrendDatum) {
    return Number.isFinite(datum.x) && Number.isFinite(datum.y) && !!datum.y
}

function hasFiniteRangeX(datum: TrendDatum) {
    return Number.isFinite(datumRangeStart(datum)) && Number.isFinite(datumRangeEnd(datum))
}

function datumRangeStart(datum: TrendDatum) {
    return datum.rangeStart ?? datum.x
}

function datumRangeEnd(datum: TrendDatum) {
    return datum.rangeEnd ?? datum.x
}

export function filteredTrendData(data: TrendDatum[]) {
    return data.filter(isValidTrendDatum)
}

export function trendDataInRange(data: TrendDatum[], startX: number, endX: number) {
    const minX = Math.min(startX, endX)
    const maxX = Math.max(startX, endX)
    return data.filter((datum) => datumRangeEnd(datum) >= minX && datumRangeStart(datum) <= maxX)
}

export function createTrendFromData(data: TrendDatum[]) {
    const valid = filteredTrendData(data)
    if (valid.length < 2) {
        return
    }
    return createTrend(valid, "x", "y")
}

function trendModelFromPoints(startX: number, startY: number, endX: number, endY: number) {
    const deltaX = endX - startX
    const slope = deltaX === 0 ? 0 : (endY - startY) / deltaX
    const yStart = startY - slope * startX
    return {
        slope,
        yStart,
        calcY: (x: number) => yStart + slope * x,
    } as TrendModel
}

export function createEndpointTrendFromData(data: TrendDatum[]) {
    const valid = filteredTrendData(data).filter(hasFiniteRangeX)
    const endPoints = trendEndPoints(valid)
    if (!endPoints) {
        return
    }
    return trendModelFromPoints(
        datumRangeStart(endPoints.leftmost),
        endPoints.leftmost.y,
        datumRangeEnd(endPoints.rightmost),
        endPoints.rightmost.y
    )
}

export function trendModeWithDefault(mode: TrendMode | undefined): TrendMode {
    return mode ?? DEFAULT_TREND_MODE
}

export function toggleTrendMode(mode: TrendMode | undefined): TrendMode {
    return trendModeWithDefault(mode) === "fitted" ? "endpoints" : "fitted"
}

export function createTrendForMode(data: TrendDatum[], mode: TrendMode | undefined) {
    return trendModeWithDefault(mode) === "endpoints"
        ? createEndpointTrendFromData(data)
        : createTrendFromData(data)
}

export function nextTrendClickTransition(
    anchorX: number | undefined,
    clickedX: number
): TrendClickTransition {
    if (anchorX === undefined) {
        return { nextAnchorX: clickedX }
    }
    return { nextAnchorX: undefined, range: { startX: anchorX, endX: clickedX } }
}

export function nextTrendCancelTransition(anchorX: number | undefined): TrendCancelTransition {
    return {
        nextAnchorX: undefined,
        clearPreview: anchorX !== undefined,
    }
}

export function trendColour(index: number) {
    const inNightMode =
        typeof document !== "undefined" &&
        document.documentElement?.classList.contains("night-mode")
    const palette = inNightMode ? trendColoursNight : trendColours
    return palette[index % palette.length]
}

export function nextCustomTrendColour(trends: Pick<DrawnTrend, "kind">[]) {
    return trendColour(trends.filter((trend) => trend.kind === "custom").length)
}

export function trendPatternBySlope(
    trend: TrendLine,
    {
        pattern = "",
        positivePattern = undefined,
        negativePattern = undefined,
    }: Pick<TrendInfo, "pattern" | "positivePattern" | "negativePattern">
) {
    if (!trend || !positivePattern || !negativePattern) {
        return pattern
    }
    return trend.slope > 0 ? positivePattern : negativePattern
}

export function trendRangesEqual(a: TrendRange, b: TrendRange) {
    return (
        Math.min(a.startX, a.endX) === Math.min(b.startX, b.endX) &&
        Math.max(a.startX, a.endX) === Math.max(b.startX, b.endX)
    )
}

export function isTrendStartVisible(startX: number, visibleRange: TrendRange) {
    const visibleMin = Math.min(visibleRange.startX, visibleRange.endX)
    const visibleMax = Math.max(visibleRange.startX, visibleRange.endX)
    return startX >= visibleMin && startX <= visibleMax
}

export function isLikelyTimestampMs(value: number) {
    return Number.isFinite(value) && Math.abs(value) >= LIKELY_TIMESTAMP_MS_MIN
}

export function mapTrendRange(range: TrendRange, mapper: (x: number) => number): TrendRange {
    return {
        startX: mapper(range.startX),
        endX: mapper(range.endX),
    }
}

export function normalizeTemporalRange(
    range: TrendRange,
    fromTimestampMs: (value: number) => number
): TrendRange {
    return mapTrendRange(range, (value) =>
        isLikelyTimestampMs(value) ? fromTimestampMs(value) : value
    )
}

export function denormalizeTemporalRange(
    range: TrendRange,
    toTimestampMs: (value: number) => number
): TrendRange {
    return mapTrendRange(range, toTimestampMs)
}

export function storedTemporalRange(
    range: StoredTrendRange,
    toStoredValue: (value: number) => StoredTrendCoordinate
): StoredTrendRange {
    const mapCoordinate = (value: StoredTrendCoordinate) =>
        typeof value === "string" ? value : toStoredValue(value)
    return {
        startX: mapCoordinate(range.startX),
        endX: mapCoordinate(range.endX),
        mode: range.mode,
    }
}

export function removeTrendById(trends: DrawnTrend[], id: number) {
    return trends.filter((trend) => trend.id !== id)
}

export function replaceTrendById<T extends { id: number }>(items: T[], replacement: T) {
    return items.map((item) => (item.id === replacement.id ? replacement : item))
}

export function compareTrendsByStart(
    a: Pick<DrawnTrend, "id" | "startX" | "endX">,
    b: Pick<DrawnTrend, "id" | "startX" | "endX">
) {
    const startDiff = Math.min(a.startX, a.endX) - Math.min(b.startX, b.endX)
    if (startDiff !== 0) {
        return startDiff
    }
    const endDiff = Math.max(a.startX, a.endX) - Math.max(b.startX, b.endX)
    if (endDiff !== 0) {
        return endDiff
    }
    return a.id - b.id
}

function isStoredTrendCoordinate(value: unknown): value is StoredTrendCoordinate {
    if (typeof value === "number") {
        return Number.isFinite(value)
    }
    if (typeof value === "string") {
        return value.trim().length > 0
    }
    return false
}

function isStoredTrendMode(value: unknown): value is StoredTrendMode {
    return value === "fitted" || value === "endpoints"
}

function isTrendRange(value: unknown): value is StoredTrendRange {
    if (typeof value !== "object" || value === null) {
        return false
    }
    const candidate = value as Record<string, unknown>
    return (
        isStoredTrendCoordinate(candidate.startX) &&
        isStoredTrendCoordinate(candidate.endX) &&
        (candidate.mode === undefined || isStoredTrendMode(candidate.mode))
    )
}

export function pinnedTrendsForKey(storeKey: string) {
    const allPinned = SSEconfig.pinnedTrends ?? {}
    const stored = allPinned[storeKey]
    if (!Array.isArray(stored)) {
        return []
    }
    return stored.filter(isTrendRange)
}

export function upsertPinnedTrendsSnapshot(
    allPinned: Record<string, StoredTrendRange[]>,
    storeKey: string,
    ranges: StoredTrendRange[]
) {
    const nextPinned = { ...allPinned }
    if (ranges.length) {
        nextPinned[storeKey] = ranges
    } else {
        delete nextPinned[storeKey]
    }
    return nextPinned
}

export function upsertPinnedTrends(storeKey: string, ranges: StoredTrendRange[]) {
    const nextPinned = upsertPinnedTrendsSnapshot(SSEconfig.pinnedTrends ?? {}, storeKey, ranges)
    SSEconfig.pinnedTrends = nextPinned
    return nextPinned
}

function trendEndPoints(data: TrendDatum[]) {
    const leftmost = _.minBy(data, (datum) => datumRangeStart(datum))
    const rightmost = _.maxBy(data, (datum) => datumRangeEnd(datum))
    if (!leftmost || !rightmost) {
        return
    }
    return { leftmost, rightmost }
}

export function defaultTrendRange(data: TrendDatum[]) {
    const endPoints = trendEndPoints(filteredTrendData(data).filter(hasFiniteRangeX))
    if (!endPoints) {
        return
    }
    return {
        startX: datumRangeStart(endPoints.leftmost),
        endX: datumRangeEnd(endPoints.rightmost),
    }
}

function drawTrendLine(
    svg: d3.Selection<SVGGElement, unknown, any, any>,
    y: d3.ScaleLinear<number, number, never>,
    trend: TrendModel,
    startX: number,
    endX: number,
    x1: number,
    x2: number,
    colour = trendColour(0),
    className = "sse-trend-line",
    trendId?: number,
    lineDash = FIXED_TREND_LINE_DASH
) {
    const [rangeStart, rangeEnd] = y.range()
    const minY = Math.min(rangeStart, rangeEnd)
    const maxY = Math.max(rangeStart, rangeEnd)
    const clampY = (value: number) => Math.min(Math.max(y(value), minY), maxY)
    return svg
        .append("line")
        .attr("class", className)
        .attr("x1", x1)
        .attr("y1", clampY(trend.calcY(startX)))
        .attr("x2", x2)
        .attr("y2", clampY(trend.calcY(endX)))
        .style("stroke", colour)
        .style("stroke-width", 1.5)
        .style("stroke-dasharray", lineDash)
        .attr("data-trend-id", trendId ?? null)
}

function hoverTargets<T>(
    hoverAreas: d3.Selection<SVGRectElement, T, SVGGElement, unknown>,
    hoverToRange: (datum: T) => TrendRange
) {
    return hoverAreas
        .nodes()
        .map((node) => {
            const datum = d3.select(node).datum() as T
            const x = Number(node.getAttribute("x"))
            const width = Number(node.getAttribute("width"))
            if (!Number.isFinite(x) || !Number.isFinite(width)) {
                return
            }
            return {
                range: hoverToRange(datum),
                centerX: x + width / 2,
            }
        })
        .filter((target): target is HoverTarget => target !== undefined)
}

export function closestHoverTarget(targets: HoverTarget[], pixelX: number) {
    return _.minBy(targets, (target) => Math.abs(target.centerX - pixelX))
}

export function selectableTrendLine<T>({
    chart,
    points,
    visibleRange = undefined,
    hoverAreas,
    hoverToRange,
    xToPixel,
    onTrendsChange = () => {},
    onPreviewTrendChange = () => {},
    onControllerReady = () => {},
    initialPinnedTrends = [],
    initialTrends = [],
    onPinnedRangesChange = () => {},
    drawDefaultTrend = false,
}: TrendSelectionOptions<T>): TrendSelectionController {
    const initialPinnedSnapshot = [...initialPinnedTrends]
    const initialTrendsSnapshot = [...initialTrends]

    let removeTrend = (_id: number) => {}
    let togglePin = (_id: number) => {}
    let toggleMode = (_id: number) => {}
    let updateRange = (_id: number, _range: TrendRange) => {}
    let clear = () => {}
    const controller = {
        removeTrend: (id: number) => removeTrend(id),
        togglePin: (id: number) => togglePin(id),
        toggleMode: (id: number) => toggleMode(id),
        updateRange: (id: number, range: TrendRange) => updateRange(id, range),
        clear: () => clear(),
    }
    onControllerReady(controller)

    if (!SSEconfig.trends) {
        onTrendsChange([])
        onPreviewTrendChange(undefined)
        return controller
    }

    points = filteredTrendData(points)
    const endPointCandidates = points.filter(hasFiniteRangeX)
    const snappedHoverTargets = hoverTargets(hoverAreas, hoverToRange)
    let trends: DrawnTrend[] = []
    let nextId = 1
    let anchorX: number | undefined = undefined
    let isInitializing = true

    function emitTrends() {
        onTrendsChange([...trends])
    }

    function emitPinnedRanges() {
        if (isInitializing) {
            return
        }
        onPinnedRangesChange(
            trends
                .filter((trend) => trend.pinned)
                .map((trend) => ({
                    startX: trend.startX,
                    endX: trend.endX,
                    storedStartX: trend.storedStartX,
                    storedEndX: trend.storedEndX,
                    mode: trend.mode,
                }))
        )
    }

    function clearPreview() {
        chart.svg.selectAll("line.sse-trend-line-preview").remove()
        onPreviewTrendChange(undefined)
    }

    function removePersistentTrendGraphics(id: number) {
        chart.svg.selectAll(`g.sse-trend-line-group[data-trend-id="${id}"]`).remove()
    }

    function hoveredRangeAtPixel(pixelX: number) {
        return closestHoverTarget(snappedHoverTargets, pixelX)?.range
    }

    function applyTrendForRange(startX: number, endX: number, mode: TrendMode | undefined) {
        const rangePoints = trendDataInRange(points, startX, endX)
        const trend = createTrendForMode(rangePoints, mode)
        if (!trend) {
            return
        }

        let drawStartX = startX
        let drawEndX = endX
        if (visibleRange) {
            const rangeMin = Math.min(startX, endX)
            const rangeMax = Math.max(startX, endX)
            const visibleMin = Math.min(visibleRange.startX, visibleRange.endX)
            const visibleMax = Math.max(visibleRange.startX, visibleRange.endX)
            if (!isTrendStartVisible(startX, visibleRange)) {
                return
            }
            const clippedMin = Math.max(rangeMin, visibleMin)
            const clippedMax = Math.min(rangeMax, visibleMax)
            if (clippedMin > clippedMax) {
                return
            }
            if (startX <= endX) {
                drawStartX = clippedMin
                drawEndX = clippedMax
            } else {
                drawStartX = clippedMax
                drawEndX = clippedMin
            }
        }

        const x1 = xToPixel(drawStartX)
        const x2 = xToPixel(drawEndX)
        if (x1 === undefined || x2 === undefined) {
            return
        }
        return { trend, startX, endX, drawStartX, drawEndX, x1, x2 }
    }

    function drawPersistentTrend({
        id = nextId++,
        startX,
        endX,
        storedStartX = undefined,
        storedEndX = undefined,
        colour,
        pinned = false,
        kind = "custom",
        mode = DEFAULT_TREND_MODE,
    }: {
        id?: number
        startX: number
        endX: number
        storedStartX?: StoredTrendCoordinate
        storedEndX?: StoredTrendCoordinate
        colour: string
        pinned?: boolean
        kind?: "default" | "custom"
        mode?: TrendMode
    }) {
        const resolvedMode = trendModeWithDefault(mode)
        const trendData = applyTrendForRange(startX, endX, resolvedMode)
        if (!trendData) {
            return
        }
        const group = chart.svg
            .append("g")
            .attr("class", "sse-trend-line-group")
            .attr("data-trend-id", id)
        drawTrendLine(
            group,
            chart.y,
            trendData.trend,
            trendData.drawStartX,
            trendData.drawEndX,
            trendData.x1,
            trendData.x2,
            colour,
            "sse-trend-line sse-trend-line-persistent",
            id
        )
        if (kind === "custom") {
            const startY = chart.y(trendData.trend.calcY(trendData.drawStartX))
            const endY = chart.y(trendData.trend.calcY(trendData.drawEndX))
            const pointerX = (event: any) =>
                d3.pointer(event?.sourceEvent ?? event, chart.svg.node())[0]
            const updateEndpoint = (edge: "start" | "end") => (event: unknown) => {
                const nextRange = hoveredRangeAtPixel(pointerX(event))
                if (!nextRange) {
                    return
                }
                updateRange(id, {
                    startX: edge === "start" ? nextRange.startX : startX,
                    endX: edge === "end" ? nextRange.endX : endX,
                    mode: resolvedMode,
                })
            }

            group
                .append("circle")
                .attr("class", "sse-trend-handle sse-trend-handle-start")
                .attr("cx", trendData.x1)
                .attr("cy", startY)
                .attr("r", 4)
                .style("fill", colour)
                .style("stroke", "white")
                .style("stroke-width", 1)
                .style("cursor", "ew-resize")
                .call(d3.drag<SVGCircleElement, unknown>().on("drag", updateEndpoint("start")))

            group
                .append("circle")
                .attr("class", "sse-trend-handle sse-trend-handle-end")
                .attr("cx", trendData.x2)
                .attr("cy", endY)
                .attr("r", 4)
                .style("fill", colour)
                .style("stroke", "white")
                .style("stroke-width", 1)
                .style("cursor", "ew-resize")
                .call(d3.drag<SVGCircleElement, unknown>().on("drag", updateEndpoint("end")))
        }
        const nextTrend = {
            id,
            colour,
            trend: trendData.trend,
            startX,
            endX,
            storedStartX,
            storedEndX,
            pinned,
            kind,
            mode: resolvedMode,
        }
        trends = trends.some((trend) => trend.id === id)
            ? replaceTrendById(trends, nextTrend)
            : [...trends, nextTrend]
        emitTrends()
        emitPinnedRanges()
        clearPreview()
    }

    function drawPreviewTrend(startX: number, endX: number) {
        const trendData = applyTrendForRange(startX, endX, DEFAULT_TREND_MODE)
        if (!trendData) {
            clearPreview()
            return
        }
        const previewColour = nextCustomTrendColour(trends)
        chart.svg.selectAll("line.sse-trend-line-preview").remove()
        drawTrendLine(
            chart.svg,
            chart.y,
            trendData.trend,
            trendData.drawStartX,
            trendData.drawEndX,
            trendData.x1,
            trendData.x2,
            previewColour,
            "sse-trend-line-preview",
            undefined,
            PREVIEW_TREND_LINE_DASH
        )
        onPreviewTrendChange(trendData.trend)
    }

    removeTrend = (id: number) => {
        trends = removeTrendById(trends, id)
        removePersistentTrendGraphics(id)
        emitTrends()
        emitPinnedRanges()
    }

    togglePin = (id: number) => {
        trends = trends.map((trend) =>
            trend.id === id ? { ...trend, pinned: !trend.pinned } : trend
        )
        emitTrends()
        emitPinnedRanges()
    }

    toggleMode = (id: number) => {
        const trendToRedraw = trends.find((trend) => trend.id === id)
        if (!trendToRedraw) {
            return
        }
        removePersistentTrendGraphics(id)
        drawPersistentTrend({
            id,
            startX: trendToRedraw.startX,
            endX: trendToRedraw.endX,
            storedStartX: trendToRedraw.storedStartX,
            storedEndX: trendToRedraw.storedEndX,
            colour: trendToRedraw.colour,
            pinned: trendToRedraw.pinned,
            kind: trendToRedraw.kind,
            mode: toggleTrendMode(trendToRedraw.mode),
        })
    }

    updateRange = (id: number, range: TrendRange) => {
        const trendToRedraw = trends.find((trend) => trend.id === id)
        if (!trendToRedraw) {
            return
        }
        removePersistentTrendGraphics(id)
        drawPersistentTrend({
            id,
            startX: range.startX,
            endX: range.endX,
            storedStartX: range.storedStartX,
            storedEndX: range.storedEndX,
            colour: trendToRedraw.colour,
            pinned: trendToRedraw.pinned,
            kind: trendToRedraw.kind,
            mode: range.mode ?? trendToRedraw.mode,
        })
    }

    clear = () => {
        trends = []
        chart.svg.selectAll("g.sse-trend-line-group").remove()
        clearPreview()
        emitTrends()
        emitPinnedRanges()
    }

    emitTrends()
    clearPreview()
    for (const initialTrend of initialTrendsSnapshot.filter(
        (trend) =>
            Number.isFinite(trend.startX) &&
            Number.isFinite(trend.endX) &&
            typeof trend.colour === "string"
    )) {
        drawPersistentTrend({
            startX: initialTrend.startX,
            endX: initialTrend.endX,
            storedStartX: initialTrend.storedStartX,
            storedEndX: initialTrend.storedEndX,
            colour: initialTrend.colour,
            pinned: initialTrend.pinned,
            kind: initialTrend.kind,
            mode: initialTrend.mode,
        })
    }

    for (const pinnedTrend of initialPinnedSnapshot.filter(isTrendRange)) {
        const existing = trends.find((trend) => trendRangesEqual(trend, pinnedTrend))
        if (existing) {
            if (!existing.pinned) {
                trends = trends.map((trend) =>
                    trend.id === existing.id ? { ...trend, pinned: true } : trend
                )
            }
            continue
        }
        drawPersistentTrend({
            startX: pinnedTrend.startX,
            endX: pinnedTrend.endX,
            storedStartX: pinnedTrend.storedStartX,
            storedEndX: pinnedTrend.storedEndX,
            colour: nextCustomTrendColour(trends),
            pinned: true,
            kind: "custom",
            mode: pinnedTrend.mode,
        })
    }
    if (initialPinnedSnapshot.length) {
        emitTrends()
    }

    if (drawDefaultTrend && !trends.some((trend) => trend.kind === "default")) {
        const defaultRange = defaultTrendRange(endPointCandidates)
        if (defaultRange) {
            drawPersistentTrend({
                startX: defaultRange.startX,
                endX: defaultRange.endX,
                colour: DEFAULT_TREND_COLOUR,
                kind: "default",
                mode: DEFAULT_TREND_MODE,
            })
        }
    }
    isInitializing = false

    hoverAreas
        .on("mousemove.trend", (_, datum) => {
            if (anchorX === undefined) {
                return
            }
            const hoverRange = hoverToRange(datum)
            drawPreviewTrend(anchorX, hoverRange.endX)
        })
        .on("click.trend", (_, datum) => {
            const hoverRange = hoverToRange(datum)
            if (anchorX === undefined) {
                anchorX = hoverRange.startX
                clearPreview()
                return
            }
            drawPersistentTrend({
                startX: anchorX,
                endX: hoverRange.endX,
                colour: nextCustomTrendColour(trends),
                kind: "custom",
            })
            anchorX = undefined
        })
        .on("contextmenu.trend", (event) => {
            const transition = nextTrendCancelTransition(anchorX)
            anchorX = transition.nextAnchorX
            if (!transition.clearPreview) {
                return
            }
            event.preventDefault()
            clearPreview()
        })

    return controller
}

export function trendLine({ svg, x, y }: ExtraRenderInput<unknown>, data: TrendDatum[]) {
    if (!SSEconfig.trends) {
        return
    }

    const validData = filteredTrendData(data)
    const trend = createTrendFromData(validData)
    if (!trend) {
        return
    }

    const endPoints = trendEndPoints(validData)
    if (!endPoints) {
        return
    }

    const half_step = x.step() / 2
    const x1 = x(endPoints.leftmost.x.toString())
    const x2 = x(endPoints.rightmost.x.toString())

    if (x1 === undefined || x2 === undefined) {
        return trend
    }

    svg.selectAll("line.sse-trend-line").remove()
    drawTrendLine(
        svg,
        y,
        trend,
        endPoints.leftmost.x,
        endPoints.rightmost.x,
        x1 + half_step,
        x2 + half_step
    )

    return trend
}
