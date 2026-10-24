import type { CardData } from "./cardData"
import type { ResolvedFsrsPreset } from "./config"
import { dailyMovingAverage } from "./dailyMovingAverage"
import { prepareFsrsReplay } from "./fsrsHistory"
import { elapsedFsrsDays, intervalAtRetrievability, type FsrsMemoryState } from "./fsrsModel"
import { asRevlogHistory, type RevlogInput } from "./packedRevlogs"
import { dayFromMs, rollover_ms } from "./revlogGraphs"

export interface MaturationCardHistory {
    introducedDay: number
    // Alternating Anki day / record-high S90, preserving exact threshold boundaries.
    peaks: Float64Array
}

export interface MaturationHistory {
    cards: MaturationCardHistory[]
    incompleteCards: number
    throughDay: number
}

/** Replay once; changing either display threshold only scans the compact record highs. */
export function calculateMaturationHistory(
    input: RevlogInput,
    cards: CardData[],
    presets: Record<number, ResolvedFsrsPreset>,
    snapshotNow = Date.now()
): MaturationHistory {
    const reviews = asRevlogHistory(input)
    const searched = new Set(cards.map((card) => card.id))
    const first = new Map<number, { id: number; learning: boolean }>()
    for (const review of reviews) {
        if (
            !searched.has(review.cid) ||
            review.id > snapshotNow ||
            review.ease < 1 ||
            review.ease > 4 ||
            (review.type === 3 && review.factor === 0)
        )
            continue
        if (!first.has(review.cid) || first.get(review.cid)!.id > review.id)
            first.set(review.cid, { id: review.id, learning: review.type === 0 })
    }
    type Tracker = {
        introducedDay: number
        peaks: number[]
        maximum: number
        state: FsrsMemoryState | null
        lastReview: Date | null
    }
    const tracked = new Map<number, Tracker>()
    const incomplete = new Set<number>()
    for (const { review, model, startingState, reset } of prepareFsrsReplay(
        input,
        (cid) => presets[cid]
    )) {
        if (!searched.has(review.cid) || review.id > snapshotNow || incomplete.has(review.cid))
            continue
        let card = tracked.get(review.cid)
        if (review.ease === 0) {
            if (card) {
                card.state = null
                card.lastReview = null
            }
            continue
        }
        if (!card) {
            const initial = first.get(review.cid)
            // A retained mature interval cannot reveal a card's lifetime first crossing.
            if (!initial?.learning || initial.id !== review.id || startingState) {
                incomplete.add(review.cid)
                continue
            }
            card = {
                introducedDay: dayFromMs(review.id),
                peaks: [],
                maximum: 0,
                state: null,
                lastReview: null,
            }
            tracked.set(review.cid, card)
        }
        if (reset) {
            card.state = null
            card.lastReview = null
        }
        const now = new Date(review.id)
        const elapsed = card.lastReview
            ? elapsedFsrsDays(model, card.lastReview, now, rollover_ms)
            : 0
        card.state = startingState ?? model.nextState(card.state, elapsed, review.ease)
        card.lastReview = now
        const s90 = intervalAtRetrievability(model, card.state, 0.9)
        if (!Number.isFinite(s90) || s90 <= card.maximum) continue
        const day = dayFromMs(review.id)
        if (card.peaks.length && card.peaks[card.peaks.length - 2] === day)
            card.peaks[card.peaks.length - 1] = s90
        else card.peaks.push(day, s90)
        card.maximum = s90
    }
    return {
        cards: [...tracked.values()].map((card) => ({
            introducedDay: card.introducedDay,
            peaks: Float64Array.from(card.peaks),
        })),
        incompleteCards: first.size - tracked.size,
        throughDay: dayFromMs(snapshotNow),
    }
}

export function buildMaturationSeries(history: MaturationHistory, lower: number, upper: number) {
    if (!(Number.isFinite(lower) && lower > 0 && Number.isFinite(upper) && upper > lower))
        throw new Error("Invalid maturation thresholds")
    const introduced: number[] = [],
        maturing: number[] = [],
        matured: number[] = []
    let firstDay = history.throughDay
    for (const card of history.cards) {
        firstDay = Math.min(firstDay, card.introducedDay)
        introduced[card.introducedDay] = (introduced[card.introducedDay] ?? 0) + 1
        let reachedLower = false
        for (let i = 0; i < card.peaks.length; i += 2) {
            const day = card.peaks[i],
                s90 = card.peaks[i + 1]
            if (!reachedLower && s90 >= lower) {
                maturing[day] = (maturing[day] ?? 0) + 1
                reachedLower = true
            }
            if (s90 > upper) {
                matured[day] = (matured[day] ?? 0) + 1
                break
            }
        }
    }
    const maturingRatio: number[] = [],
        maturedRatio: number[] = []
    for (let day = firstDay; day <= history.throughDay; day++) {
        introduced[day] ??= 0
        maturing[day] ??= 0
        matured[day] ??= 0
        maturingRatio[day] = introduced[day] ? (100 * maturing[day]) / introduced[day] : NaN
        maturedRatio[day] = introduced[day] ? (100 * matured[day]) / introduced[day] : NaN
    }
    return {
        introduced,
        maturing,
        matured,
        maturingRatio,
        maturedRatio,
        firstDay,
        lastDay: history.throughDay,
    }
}

export function smoothMaturationSeries(
    source: ReturnType<typeof buildMaturationSeries>,
    days: number
): ReturnType<typeof buildMaturationSeries> {
    if (!Number.isSafeInteger(days) || days < 1)
        throw new Error("Invalid maturation average window")
    const result = {
        ...source,
        introduced: [] as number[],
        maturing: [] as number[],
        matured: [] as number[],
        maturingRatio: [] as number[],
        maturedRatio: [] as number[],
    }
    const keys = ["introduced", "maturing", "matured"] as const
    const averages = keys.map((key) =>
        dailyMovingAverage(source[key].slice(source.firstDay, source.lastDay + 1), days)
    )
    for (let day = source.firstDay; day <= source.lastDay; day++) {
        keys.forEach((key, index) => {
            result[key][day] = averages[index][day - source.firstDay]!
        })
        result.maturingRatio[day] = result.introduced[day]
            ? (100 * result.maturing[day]) / result.introduced[day]
            : NaN
        result.maturedRatio[day] = result.introduced[day]
            ? (100 * result.matured[day]) / result.introduced[day]
            : NaN
    }
    return result
}
