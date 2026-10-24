export type ScrollableBarDatum = {
    values?: number[]
}

export type BarWindow = { bins: number; offset: number }

/** Zoom a window without changing its grouping or shared numeric navigation stores. */
export function zoomBarWindow(
    window: BarWindow,
    binSize: number,
    visibleBins: number,
    start: number,
    end: number,
    leftAligned: boolean
): BarWindow {
    return {
        bins: end - start + 1,
        offset: Math.abs(window.offset) + (leftAligned ? start : visibleBins - 1 - end) * binSize,
    }
}

export function effectiveBarDataLength(data: ScrollableBarDatum[]) {
    for (let index = data.length - 1; index >= 0; index--) {
        if ((data[index]?.values ?? []).some((value) => Number.isFinite(value) && value !== 0)) {
            return index + 1
        }
    }
    return 0
}

/** Scroll across the loaded domain; calendar padding before the first review is omitted. */
export function barScrollExtent(
    data: ScrollableBarDatum[],
    leftAligned: boolean,
    dateAxis: boolean
) {
    if (leftAligned) return effectiveBarDataLength(data)
    if (!dateAxis) return data.length
    const first = data.findIndex((bar) =>
        (bar?.values ?? []).some((value) => Number.isFinite(value) && value !== 0)
    )
    return first < 0 ? 0 : data.length - first
}

export function barScrollPosition(offset: number, maximum: number, leftAligned: boolean) {
    const distance = Math.min(maximum, Number.isFinite(offset) ? Math.abs(offset) : 0)
    return leftAligned ? distance : maximum - distance
}

export function barScrollOffset(position: number, maximum: number, leftAligned: boolean) {
    return leftAligned ? position : maximum - position
}

export function leftAlignedBarWindowEnd(
    leftmost: number,
    requestedEnd: number,
    binSize: number,
    data: ScrollableBarDatum[]
) {
    const dataLength = effectiveBarDataLength(data)
    if (dataLength <= leftmost) {
        return leftmost
    }

    const safeBinSize = Math.max(binSize, 1)
    const visibleEnd = Math.min(requestedEnd, dataLength)
    return leftmost + Math.ceil((visibleEnd - leftmost) / safeBinSize) * safeBinSize
}
