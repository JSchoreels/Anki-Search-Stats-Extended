import { ankiDaySnapshotMs } from "./ankiDay"
import type { CardData } from "./cardData"
import type { ResolvedFsrsPreset } from "./config"
import { prepareFsrsReplay } from "./fsrsHistory"
import { elapsedFsrsDays, getFsrs, type FsrsMemoryState, type FsrsModel } from "./fsrsModel"
import {
    allocateRevlogColumns,
    asRevlogHistory,
    REVLOG_FIELDS,
    RevlogHistory,
    type RevlogInput,
} from "./packedRevlogs"
import { dayFromMs, rollover_ms } from "./revlogGraphs"

export interface ActiveRetrievabilityThresholds {
    daysLower: number
    daysUpper: number
    rLower: number
    rUpper: number
}
export const DEFAULT_ACTIVE_RETRIEVABILITY_THRESHOLDS: ActiveRetrievabilityThresholds = {
    daysLower: 30,
    daysUpper: 180,
    rLower: 80,
    rUpper: 90,
}
export function validActiveRetrievabilityThresholds(
    value: unknown
): value is ActiveRetrievabilityThresholds {
    if (!value || typeof value !== "object") return false
    const v = value as ActiveRetrievabilityThresholds
    return (
        Number.isSafeInteger(v.daysLower) &&
        v.daysLower >= 1 &&
        Number.isSafeInteger(v.daysUpper) &&
        v.daysUpper > v.daysLower &&
        Number.isFinite(v.rLower) &&
        v.rLower > 0 &&
        Number.isFinite(v.rUpper) &&
        v.rUpper > v.rLower &&
        v.rUpper <= 100
    )
}
export function activeRetrievabilityThresholds(value: unknown): ActiveRetrievabilityThresholds {
    return {
        ...(validActiveRetrievabilityThresholds(value)
            ? value
            : DEFAULT_ACTIVE_RETRIEVABILITY_THRESHOLDS),
    }
}
export interface ActiveRetrievabilityCard {
    id: number
    days: number
    averageR: number
    workload: number
}
export interface ActiveRetrievabilityHistory {
    cards: ActiveRetrievabilityCard[]
    excluded: number
    incomplete: number
}

/** One snapshot per Anki day, including introduction and today's partial day. */
export function calculateActiveRetrievabilityHistory(
    input: RevlogInput,
    cards: CardData[],
    presets: Record<number, ResolvedFsrsPreset>,
    snapshotNow = Date.now()
): ActiveRetrievabilityHistory {
    let reviews = asRevlogHistory(input)
    // Future rows must not affect the native history selector's cycle initialization.
    let retained = 0
    for (const review of reviews) if (review.id <= snapshotNow) retained++
    if (retained !== reviews.length) {
        const columns = allocateRevlogColumns(retained)
        let index = 0
        for (const review of reviews)
            if (review.id <= snapshotNow) {
                for (const field of REVLOG_FIELDS) columns[field][index] = review[field]
                index++
            }
        reviews = new RevlogHistory(columns)
    }
    const eligible = new Map<number, CardData>()
    const seen = new Set<number>()
    let excluded = 0
    for (const card of cards) {
        if (seen.has(card.id)) continue
        seen.add(card.id)
        if (card.type === 0 || card.queue < 0 || !Number.isInteger(card.reps) || card.reps < 1)
            excluded++
        else eligible.set(card.id, card)
    }
    const supportedPresets = new Map<ResolvedFsrsPreset, boolean>()
    const sourceForCard = (id: number) => {
        if (!eligible.has(id)) return
        const preset = presets[id]
        if (!preset) return
        if (!supportedPresets.has(preset)) {
            try {
                getFsrs(preset)
                supportedPresets.set(preset, true)
            } catch {
                supportedPresets.set(preset, false)
            }
        }
        return supportedPresets.get(preset) ? preset : undefined
    }
    const first = new Map<number, { id: number; learning: boolean }>()
    for (const review of reviews) {
        if (
            !eligible.has(review.cid) ||
            review.ease < 1 ||
            review.ease > 4 ||
            (review.type === 3 && review.factor === 0)
        )
            continue
        if (!first.has(review.cid) || review.id < first.get(review.cid)!.id)
            first.set(review.cid, { id: review.id, learning: review.type === 0 })
    }
    type Tracker = {
        introduced: number
        nextDay: number
        sum: number
        samples: number
        state: FsrsMemoryState | null
        lastReview: Date | null
        model: FsrsModel
        incomplete: boolean
    }
    const trackers = new Map<number, Tracker>()
    const invalid = new Set<number>()
    const throughDay = dayFromMs(snapshotNow)
    const sample = (tracker: Tracker, beforeDay: number) => {
        while (tracker.nextDay < beforeDay) {
            if (!tracker.state || !tracker.lastReview) tracker.incomplete = true
            else {
                const at = ankiDaySnapshotMs(tracker.nextDay, rollover_ms / 3600000, snapshotNow)
                const elapsed = elapsedFsrsDays(
                    tracker.model,
                    tracker.lastReview,
                    new Date(at),
                    rollover_ms
                )
                const r = tracker.model.retrievability(tracker.state, elapsed)
                if (!Number.isFinite(r) || r < 0 || r > 1) tracker.incomplete = true
                tracker.sum += r
                tracker.samples++
            }
            tracker.nextDay++
        }
    }
    for (const { review, model, startingState, reset } of prepareFsrsReplay(
        reviews,
        sourceForCard
    )) {
        if (invalid.has(review.cid)) continue
        let tracker = trackers.get(review.cid)
        const day = dayFromMs(review.id)
        if (tracker) sample(tracker, day)
        if (review.ease === 0) {
            if (tracker) {
                tracker.state = null
                tracker.lastReview = null
            }
            continue
        }
        if (!tracker) {
            const initial = first.get(review.cid)
            if (!initial?.learning || initial.id !== review.id || startingState) {
                invalid.add(review.cid)
                continue
            }
            tracker = {
                introduced: day,
                nextDay: day,
                sum: 0,
                samples: 0,
                state: null,
                lastReview: null,
                model,
                incomplete: false,
            }
            trackers.set(review.cid, tracker)
        }
        if (startingState || review.ease < 1 || review.ease > 4) tracker.incomplete = true
        if (reset) {
            tracker.state = null
            tracker.lastReview = null
        }
        const now = new Date(review.id)
        const elapsed = tracker.lastReview
            ? elapsedFsrsDays(model, tracker.lastReview, now, rollover_ms)
            : 0
        tracker.state = startingState ?? model.nextState(tracker.state, elapsed, review.ease)
        tracker.lastReview = now
    }
    const result: ActiveRetrievabilityCard[] = []
    for (const [id, tracker] of trackers) {
        sample(tracker, throughDay + 1)
        const days = throughDay - tracker.introduced + 1
        if (tracker.incomplete || tracker.samples !== days) continue
        result.push({
            id,
            days,
            averageR: (100 * tracker.sum) / days,
            workload: 1 / Math.max(eligible.get(id)!.ivl, 1),
        })
    }
    return { cards: result, excluded, incomplete: eligible.size - result.length }
}
export interface ActiveRetrievabilityCell {
    count: number
    workload: number
    ids: number[]
}
const empty = (): ActiveRetrievabilityCell => ({ count: 0, workload: 0, ids: [] })
function sum(cells: ActiveRetrievabilityCell[]): ActiveRetrievabilityCell {
    const total = empty()
    for (const cell of cells) {
        total.count += cell.count
        total.workload += cell.workload
        for (const id of cell.ids) total.ids.push(id)
    }
    return total
}
export function activeRetrievabilityCellSearch(cell: ActiveRetrievabilityCell) {
    return cell.ids.length ? `cid:${cell.ids.join(",")}` : "cid:0"
}
export function buildActiveRetrievabilityMatrix(
    cards: ActiveRetrievabilityCard[],
    thresholds: ActiveRetrievabilityThresholds
) {
    if (!validActiveRetrievabilityThresholds(thresholds))
        throw new Error("Invalid active/retrievability thresholds")
    const cells = Array.from({ length: 3 }, () => Array.from({ length: 3 }, empty))
    for (const card of cards) {
        const row = card.days < thresholds.daysLower ? 0 : card.days > thresholds.daysUpper ? 2 : 1
        const column =
            card.averageR < thresholds.rLower ? 0 : card.averageR > thresholds.rUpper ? 2 : 1
        const cell = cells[row][column]
        cell.count++
        cell.workload += card.workload
        cell.ids.push(card.id)
    }
    return {
        cells,
        rowTotals: cells.map(sum),
        columnTotals: [0, 1, 2].map((c) => sum(cells.map((row) => row[c]))),
        diagonal: sum(cells.map((row, i) => row[i])),
        total: sum(cells.flat()),
    }
}
