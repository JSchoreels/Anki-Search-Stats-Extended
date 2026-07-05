export type ScrollableBarDatum = {
    values?: number[]
}

export function effectiveBarDataLength(data: ScrollableBarDatum[]) {
    for (let index = data.length - 1; index >= 0; index--) {
        if ((data[index]?.values ?? []).some((value) => Number.isFinite(value) && value !== 0)) {
            return index + 1
        }
    }
    return 0
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
