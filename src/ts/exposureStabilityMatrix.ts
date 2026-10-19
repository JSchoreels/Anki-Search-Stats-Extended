import { getExtraDataFromCard, getFsrsS90FromExtraData, type CardData } from "./cardData"

export interface ExposureStabilityThresholds {
    repsLower: number
    repsUpper: number
    s90Lower: number
    s90Upper: number
}

export const DEFAULT_EXPOSURE_STABILITY_THRESHOLDS: ExposureStabilityThresholds = {
    repsLower: 5,
    repsUpper: 30,
    s90Lower: 7,
    s90Upper: 30,
}

export function validExposureStabilityThresholds(
    value: unknown
): value is ExposureStabilityThresholds {
    if (!value || typeof value !== "object") return false
    const v = value as ExposureStabilityThresholds
    return (
        Number.isInteger(v.repsLower) &&
        v.repsLower >= 1 &&
        Number.isInteger(v.repsUpper) &&
        v.repsUpper > v.repsLower &&
        Number.isFinite(v.s90Lower) &&
        v.s90Lower > 0 &&
        Number.isFinite(v.s90Upper) &&
        v.s90Upper > v.s90Lower
    )
}

export function exposureStabilityThresholds(value: unknown): ExposureStabilityThresholds {
    return {
        ...(validExposureStabilityThresholds(value)
            ? value
            : DEFAULT_EXPOSURE_STABILITY_THRESHOLDS),
    }
}

export function exposureStabilityCellSearch(
    row: number,
    column: number,
    thresholds: ExposureStabilityThresholds
): string {
    // Exposure is on rows and S90 on columns; index 3 selects a total.
    const reps = [
        `prop:reps<${thresholds.repsLower}`,
        `prop:reps>=${thresholds.repsLower} prop:reps<=${thresholds.repsUpper}`,
        `prop:reps>${thresholds.repsUpper}`,
        "",
    ][row]
    const stability = [
        `prop:s<${thresholds.s90Lower}`,
        `prop:s>=${thresholds.s90Lower} prop:s<=${thresholds.s90Upper}`,
        `prop:s>${thresholds.s90Upper}`,
        "",
    ][column]
    return ["-is:new -is:suspended -is:buried prop:reps>0 prop:s>0", reps, stability]
        .filter(Boolean)
        .join(" ")
}

export interface ExposureStabilityCard {
    id: number
    reps: number
    s90: number
    workload: number
}

export function prepareExposureStabilityCards(cards: CardData[]) {
    const prepared: ExposureStabilityCard[] = []
    const seen = new Set<number>()
    let excluded = 0
    for (const card of cards) {
        if (seen.has(card.id)) continue
        seen.add(card.id)
        const data = getExtraDataFromCard(card)
        const s90 = getFsrsS90FromExtraData(data)
        if (
            card.type === 0 ||
            card.queue < 0 ||
            !Number.isInteger(card.reps) ||
            card.reps < 1 ||
            s90 === undefined
        ) {
            excluded++
            continue
        }
        prepared.push({ id: card.id, reps: card.reps, s90, workload: 1 / Math.max(card.ivl, 1) })
    }
    return { cards: prepared, excluded }
}

export interface ExposureStabilityCell {
    count: number
    workload: number
}

function sumCells(cells: ExposureStabilityCell[]): ExposureStabilityCell {
    return cells.reduce(
        (sum, cell) => ({
            count: sum.count + cell.count,
            workload: sum.workload + cell.workload,
        }),
        { count: 0, workload: 0 }
    )
}

export function buildExposureStabilityMatrix(
    cards: ExposureStabilityCard[],
    thresholds: ExposureStabilityThresholds
) {
    if (!validExposureStabilityThresholds(thresholds))
        throw new Error("Invalid exposure/stability thresholds")
    const cells: ExposureStabilityCell[][] = Array.from({ length: 3 }, () =>
        Array.from({ length: 3 }, () => ({ count: 0, workload: 0 }))
    )
    let totalWorkload = 0
    for (const card of cards) {
        const row = card.reps < thresholds.repsLower ? 0 : card.reps > thresholds.repsUpper ? 2 : 1
        const column = card.s90 < thresholds.s90Lower ? 0 : card.s90 > thresholds.s90Upper ? 2 : 1
        const cell = cells[row][column]
        cell.count++
        cell.workload += card.workload
        totalWorkload += card.workload
    }
    return {
        cells,
        rowTotals: cells.map(sumCells),
        columnTotals: [0, 1, 2].map((column) => sumCells(cells.map((row) => row[column]))),
        diagonal: sumCells(cells.map((row, index) => row[index])),
        count: cards.length,
        totalWorkload,
    }
}
