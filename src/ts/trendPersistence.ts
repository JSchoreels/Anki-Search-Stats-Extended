import { dayFromDateString, dayFromMs, dayToDateString } from "./revlogGraphs"
import { type StoredTrendCoordinate, type StoredTrendRange, type TrendRange } from "./trend"

export type ParsedStoredRange = {
    original: StoredTrendRange
    normalized: TrendRange
    stored: StoredTrendRange
}

const strictNumericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

function storedCoordinateToNumber(value: StoredTrendCoordinate) {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined
    }
    const normalized = value.trim()
    if (!strictNumericPattern.test(normalized)) {
        return
    }
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : undefined
}

function storedCoordinateToDay(value: StoredTrendCoordinate) {
    if (typeof value !== "string") {
        return
    }
    const normalized = value.trim().toLowerCase()
    if (normalized === "today") {
        return dayFromMs(Date.now())
    }
    return dayFromDateString(value.trim())
}

function storedTemporalCoordinate(
    day: number,
    storedCoordinate: StoredTrendCoordinate | undefined
): StoredTrendCoordinate {
    if (typeof storedCoordinate === "string" && storedCoordinate.trim().toLowerCase() === "today") {
        return "today"
    }
    return dayToDateString(day)
}

export function toStoredRange(range: TrendRange, temporalAxis: boolean): StoredTrendRange {
    if (!temporalAxis) {
        return {
            startX: range.startX,
            endX: range.endX,
            mode: range.mode,
        }
    }
    return {
        startX: storedTemporalCoordinate(range.startX, range.storedStartX),
        endX: storedTemporalCoordinate(range.endX, range.storedEndX),
        mode: range.mode,
    }
}

export function fromStoredRange(
    range: StoredTrendRange,
    temporalAxis: boolean
): TrendRange | undefined {
    const converter = temporalAxis ? storedCoordinateToDay : storedCoordinateToNumber
    const startX = converter(range.startX)
    const endX = converter(range.endX)
    if (startX === undefined || endX === undefined) {
        return
    }
    return {
        startX,
        endX,
        storedStartX: range.startX,
        storedEndX: range.endX,
        mode: range.mode,
    }
}

export function parseStoredRanges(storedRanges: StoredTrendRange[], temporalAxis: boolean) {
    return storedRanges
        .map((range) => {
            const normalized = fromStoredRange(range, temporalAxis)
            if (!normalized) {
                return
            }
            return {
                original: range,
                normalized,
                stored: toStoredRange(normalized, temporalAxis),
            }
        })
        .filter((range): range is ParsedStoredRange => range !== undefined)
}

export function needsStoredRangeMigration(parsedRanges: ParsedStoredRange[]) {
    return parsedRanges.some(
        ({ original, stored }) => original.startX !== stored.startX || original.endX !== stored.endX
    )
}
