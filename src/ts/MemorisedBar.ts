import _ from "lodash"
import {
    type Card,
    checkParameters,
    createEmptyCard,
    dateDiffInDays,
    type FSRS,
    fsrs as Fsrs,
    type FSRSState,
    FSRSVersion,
    generatorParameters,
} from "ts-fsrs"
import type { LossBar } from "./bar"
import type { DeckConfig } from "./config"
import { selectTsFsrsParams } from "./fsrsParams"
import { type Buckets, dayFromMs, emptyBuckets, IDify, rollover_ms, today } from "./revlogGraphs"
import type { CardData, Revlog } from "./search"

export interface LossBin {
    real: number
    predicted: number
    count: number
}

/**
 * Accurately implements the FSRS outlier filtering logic from the reference Rust code.
 * This function identifies cards whose first review interval is an outlier and returns
 * a set of all revlog IDs belonging to those cards.
 * @param revlogs The full list of review logs.
 * @returns A Set containing the IDs of all revlogs for cards deemed outliers.
 */
function applyOutlierFilter(revlogs: Revlog[]): Set<number> {
    // Step 1: Group revlogs by card and identify the first review interval.
    // An "item" here represents a card's second review and its history.
    type SecondReviewItem = {
        cardId: number
        firstRating: number
        secondRating: number
        deltaT: number
    }
    const secondReviewItems: SecondReviewItem[] = []
    const revlogsByCard = _.groupBy(revlogs, (r) => r.cid)

    for (const cardId in revlogsByCard) {
        const cardRevlogs = revlogsByCard[cardId]
        if (cardRevlogs.length < 2) continue

        const firstReview = cardRevlogs[0]
        const secondReview = cardRevlogs[1]
        const thirdReview = cardRevlogs[2]

        if (firstReview && secondReview && thirdReview) {
            secondReviewItems.push({
                cardId: Number(cardId),
                firstRating: firstReview.ease,
                secondRating: secondReview.ease,
                deltaT: dateDiffInDays(new Date(secondReview.id), new Date(thirdReview.id)),
            })
        }
    }

    // Step 2: Group items by first rating and then by delta_t.
    // groups[firstRating][deltaT] = items[]
    const groups: Record<number, Record<number, SecondReviewItem[]>> = {}
    for (const item of secondReviewItems) {
        const ratingGroup = (groups[item.firstRating] ??= {})
        const deltaTGroup = (ratingGroup[item.deltaT] ??= [])
        deltaTGroup.push(item)
    }

    // This will store the (firstRating, deltaT) pairs that are marked for removal.
    const removedPairs: Record<number, Set<number>> = {
        1: new Set(),
        2: new Set(),
        3: new Set(),
        4: new Set(),
    }

    // Step 3: Apply the filtering logic to each rating group.
    for (const ratingStr in groups) {
        const rating = Number(ratingStr)
        if (rating == 0) {
            continue
        }

        const deltaTGroups = groups[rating]

        let subGroups = Object.entries(deltaTGroups).map(([dt, items]) => ({
            deltaT: Number(dt),
            items: items,
        }))

        // Sort by number of items (asc), then by delta_t (asc).
        // This is equivalent to the Rust code's sort followed by a reverse iteration.
        subGroups.sort((a, b) => {
            if (a.items.length !== b.items.length) {
                return a.items.length - b.items.length
            }
            return a.deltaT - b.deltaT
        })

        const totalInGroup = subGroups.reduce((sum, sg) => sum + sg.items.length, 0)
        const removalThreshold = Math.max(20, Math.floor(totalInGroup / 20))
        let hasBeenRemoved = 0

        for (const subGroup of subGroups) {
            // Phase 1: Unconditionally remove the smallest groups until the threshold is met.
            if (hasBeenRemoved + subGroup.items.length < removalThreshold) {
                hasBeenRemoved += subGroup.items.length
                removedPairs[rating].add(subGroup.deltaT)
                continue
            }

            // Phase 2: Conditionally keep or remove remaining groups.
            const keep = subGroup.items.length >= 6 && subGroup.deltaT <= (rating !== 4 ? 100 : 365)
            if (!keep) {
                removedPairs[rating].add(subGroup.deltaT)
            }
        }
    }

    // Step 4: Identify all revlogs for cards whose first interval was flagged for removal.
    const cardIdToPair = new Map<number, { firstRating: number; deltaT: number }>()
    for (const item of secondReviewItems) {
        cardIdToPair.set(item.cardId, { firstRating: item.firstRating, deltaT: item.deltaT })
    }

    const excludedRevlogIds = new Set<number>()
    for (const revlog of revlogs) {
        const pair = cardIdToPair.get(revlog.cid)
        if (pair && removedPairs[pair.firstRating]?.has(pair.deltaT)) {
            excludedRevlogIds.add(revlog.id)
        }
    }

    // Remove non contiguous revlogs
    const ignoredCids = new Set<number>()
    for (const revlog of revlogs) {
        if (ignoredCids.has(revlog.cid)) {
            excludedRevlogIds.add(revlog.id)
        }
        if (excludedRevlogIds.has(revlog.id)) {
            ignoredCids.add(revlog.cid)
        }
    }

    if (excludedRevlogIds.size > 0) {
        console.log(`Outlier filter excluded ${excludedRevlogIds.size} reviews from stats.`)
    }

    return excludedRevlogIds
}

let deckFsrs: Record<number, FSRS> = {}
export function getFsrs(config: DeckConfig) {
    const id = config.id
    if (!deckFsrs[id]) {
        const params = selectTsFsrsParams(config)

        deckFsrs[id] = Fsrs(
            generatorParameters({
                w: checkParameters(params),
                enable_fuzz: false,
                enable_short_term: true,
            })
        )
    }
    return deckFsrs[id]
}

const STABILITY_WEIGHT_FACTOR = 8 / 365
const TARGET_RETRIEVABILITY = 0.9
const S90_DEDUP_STABILITY_STEP_LOW = 0.1
const S90_DEDUP_STABILITY_STEP_HIGH = 0.5
const S90_DEDUP_STABILITY_THRESHOLD = 10

function stability_weight(s: number): number {
    return 1 - Math.exp(-STABILITY_WEIGHT_FACTOR * s)
}

export function s90DedupStepForStability(stability: number): number {
    return stability > S90_DEDUP_STABILITY_THRESHOLD
        ? S90_DEDUP_STABILITY_STEP_HIGH
        : S90_DEDUP_STABILITY_STEP_LOW
}

function stabilityBucketForS90(stability: number): { step: number; bucket: number } {
    const step = s90DedupStepForStability(stability)
    return {
        step,
        bucket: Math.round(stability / step),
    }
}

type S90BatchItem = {
    config_id: number
    stability: number
}

export type S90BatchResolver = (
    items: S90BatchItem[],
    targetRetrievability: number
) => Promise<number[]>

async function resolveS90BatchWithAnki(
    items: S90BatchItem[],
    targetRetrievability: number
): Promise<number[]> {
    if (!items.length) {
        return []
    }
    const resp = await fetch("/_anki/fsrsS90Batch", {
        method: "POST",
        body: JSON.stringify({
            items,
            target_retrievability: targetRetrievability,
        }),
        headers: { "Content-Type": "application/binary" },
    })
    if (!resp.ok) {
        throw new Error(`fsrsS90Batch failed: ${resp.status}`)
    }
    const body = await resp.text()
    if (body === "") {
        return []
    }
    return JSON.parse(body)
}

// Constants for B-W matrix
const R_BIN_POWER = 1.4
const LOG_R_BIN_POWER = Math.log(R_BIN_POWER)

export async function getMemorisedDays(
    revlogs: Revlog[],
    cards: CardData[],
    configs: typeof SSEother.deck_configs,
    config_mapping: typeof SSEother.deck_config_ids,
    last_forget: number[] = [],
    leech_elapsed_threshold = 2,
    leech_min_reviews = 2,
    resolveS90Batch: S90BatchResolver = resolveS90BatchWithAnki
) {
    console.log(`ts-fsrs ${FSRSVersion}`)

    // Apply the new outlier filtering logic at the start.
    console.time("Applying outlier filter")
    const excludedRevlogIds = applyOutlierFilter(revlogs)
    console.timeEnd("Applying outlier filter")

    console.time("Calculating memorised days")
    let fsrsCards: Record<number, Card> = {}
    let cards_by_id = IDify(cards)

    let retrievabilityDays: number[] = []
    let totalCards: number[] = []
    let noteRetrievabilityDays: number[] = []
    let stable_retrievability_days: number[] = []

    let cardCounts = cards.reduce(
        (p, c) => {
            p[c.nid] = (p[c.nid] ?? 0) + 1
            return p
        },
        <number[]>[]
    )

    function card_config(cid: number) {
        const card = cards_by_id[cid]
        if (!card) {
            return undefined
        }
        return configs[config_mapping[card.odid || card.did]]
    }

    let stability_day_bins: number[][] = []
    let difficulty_day_bins: number[][] = []

    const calibration_bin_count = 20
    let calibration = <LossBin[]>Array(calibration_bin_count)

    function forgetting_curve(
        fsrs: FSRS,
        s: number,
        from: number,
        to: number,
        card: Card,
        cid: number
    ) {
        for (let day = from; day < to; day++) {
            const retrievability = fsrs.forgetting_curve(day - from, s)
            const card_count = cardCounts[cards_by_id[cid].nid]
            retrievabilityDays[day] = (retrievabilityDays[day] || 0) + retrievability
            totalCards[day] = (totalCards[day] | 0) + 1

            // Ignore deleted notes for note count
            if (card_count) {
                noteRetrievabilityDays[day] =
                    (noteRetrievabilityDays[day] || 0) + retrievability / card_count
            }
            // If the cards not been forgotten
            if (card.stability) {
                const stability_bin = Math.round(s)
                stability_day_bins[day] ??= []
                stability_day_bins[day][stability_bin] =
                    (stability_day_bins[day][stability_bin] || 0) + 1
                const difficulty_bin = Math.round(card.difficulty * 10) - 1
                difficulty_day_bins[day] ??= Array(100).fill(0)
                difficulty_day_bins[day][difficulty_bin] += 1
                stable_retrievability_days[day] =
                    (stable_retrievability_days[day] || 0) +
                    retrievability * stability_weight(card.stability)
            }
        }
    }

    let last_stability: number[] = []
    let s90_by_key = new Map<string, number>()
    let s90_events_by_day = new Map<number, { card_id: number; key: string }[]>()
    let s90_request_items: S90BatchItem[] = []
    let s90_request_index_by_key = new Map<string, number>()
    let s90_dedup_total = 0
    let s90_deduped_total = 0
    let s90_backend_calls = 0

    function incrementCount(map: Map<string, number>, key: string, delta: number) {
        const next = (map.get(key) ?? 0) + delta
        if (next > 0) {
            map.set(key, next)
        } else {
            map.delete(key)
        }
    }

    function weightedValueAtRank(entries: { s90: number; count: number }[], rank: number): number {
        let seen = 0
        for (const entry of entries) {
            seen += entry.count
            if (rank < seen) {
                return entry.s90
            }
        }
        return entries.length > 0 ? entries[entries.length - 1].s90 : 0
    }

    function weightedMedian(entries: { s90: number; count: number }[], totalCount: number): number {
        if (!entries.length || totalCount <= 0) {
            return 0
        }
        const rank = (totalCount - 1) * 0.5
        const lowRank = Math.floor(rank)
        const highRank = Math.ceil(rank)
        const lowValue = weightedValueAtRank(entries, lowRank)
        if (lowRank === highRank) {
            return lowValue
        }
        const highValue = weightedValueAtRank(entries, highRank)
        const fraction = rank - lowRank
        return lowValue + fraction * (highValue - lowValue)
    }

    function dayStatsFromS90Counts(counts: Map<string, number>, totalCount: number) {
        if (totalCount <= 0) {
            return {
                mean: 0,
                median: 0,
                youngRatio: 0,
            }
        }
        let weightedSum = 0
        let youngCount = 0
        const entries: { s90: number; count: number }[] = []
        for (const [key, count] of counts) {
            if (count <= 0) {
                continue
            }
            const s90 = s90_by_key.get(key) ?? 0
            entries.push({ s90, count })
            weightedSum += s90 * count
            if (s90 < 21) {
                youngCount += count
            }
        }
        entries.sort((a, b) => a.s90 - b.s90)
        return {
            mean: weightedSum / totalCount,
            median: weightedMedian(entries, totalCount),
            youngRatio: youngCount / totalCount,
        }
    }

    const default_bin = { predicted: 0, real: 0, count: 0 }
    function incrementLoss(bin: LossBin | null, predicted: number, real: number) {
        bin ??= { ...default_bin }

        bin.predicted = (bin.predicted || 0) + predicted
        bin.real = (bin.real || 0) + real
        bin.count = (bin.count || 0) + 1

        return bin
    }

    let fatigue_bins: Buckets<LossBin[]> = emptyBuckets(() => [])
    let today_so_far = 0
    let last_date = new Date()

    let bw_matrix_count: Record<number, LossBin[]> = {}
    let day_medians: number[] = []
    let day_means: number[] = []
    let day_young_ratio_s90: number[] = []
    let review_days: number[] = []
    const uniqueCids = new Set(revlogs.map((r) => r.cid))
    let probabilities: Record<number, number[]> = {}
    for (const cid of uniqueCids) probabilities[cid] = [1]

    // let log: any[] = []
    for (const revlog of revlogs) {
        const config = card_config(revlog.cid)
        if (!config) {
            continue
        }

        const grade = revlog.ease
        const new_card = !fsrsCards[revlog.cid]
        const now = new Date(revlog.id)
        const fsrs = getFsrs(config)
        let card = fsrsCards[revlog.cid] ?? createEmptyCard(new Date(revlog.cid))
        const revlogDay = dayFromMs(revlog.id)

        if (review_days.length === 0 || review_days[review_days.length - 1] !== revlogDay) {
            review_days.push(revlogDay)
        }

        // on forget
        if (revlog.factor == 0 && revlog.type == 4 && !new_card) {
            card = fsrs.forget(card, now).card
            fsrsCards[revlog.cid] = card
            probabilities[revlog.cid] = [1]
        }
        // set due date or reschedule
        if (grade == 0) {
            continue
        }
        // cram
        if (revlog.type == 3 && revlog.factor == 0) {
            continue
        }
        if (last_stability[revlog.cid]) {
            const previous = dayFromMs(card.last_review!.getTime())
            const stability = last_stability[revlog.cid]
            forgetting_curve(fsrs, stability, previous, revlogDay, card, revlog.cid)
        }

        let memoryState: FSRSState | null = null
        let elapsed = 0
        if (card.last_review) {
            memoryState = card.stability
                ? {
                      difficulty: card.difficulty,
                      stability: card.stability,
                  }
                : null
            const oldDate = new Date(card.last_review.getTime() - rollover_ms)
            oldDate.setHours(0, 0, 0, 0)
            const newDate = new Date(now.getTime() - rollover_ms)
            newDate.setHours(0, 0, 0, 0)
            elapsed = dateDiffInDays(oldDate, newDate)

            if (newDate.getTime() != last_date.getTime()) {
                today_so_far = 0
                last_date = newDate
            }

            const p = fsrs.forgetting_curve(elapsed, card.stability)
            const y = grade > 1 ? 1 : 0

            let card_type: LossBin[]

            fatigue_bins.all[today_so_far] = incrementLoss(fatigue_bins.all[today_so_far], p, y)

            if (elapsed >= 1) {
                if (elapsed >= leech_elapsed_threshold) {
                    if (!new_card) {
                        const leech_probabilities = probabilities[revlog.cid]
                        for (let j = leech_probabilities.length + y - 1; j >= 0; j--) {
                            leech_probabilities[j] =
                                (leech_probabilities[j] ?? 0) * (1 - p) +
                                (j > 0 ? leech_probabilities[j - 1] * p : 0)
                        }
                    }
                }

                if (!new_card && (last_forget[revlog.cid] ?? 0) < revlog.id) {
                    // B-W matrix
                    if (card.stability > 1) {
                        const exp = Math.floor(Math.log(card.stability) / LOG_R_BIN_POWER)
                        const r_bin = Math.round(Math.pow(R_BIN_POWER, exp) * 100) / 100
                        const d_bin = Math.round(card.difficulty)
                        bw_matrix_count[r_bin] ??= []
                        let retention_row = bw_matrix_count[r_bin]
                        retention_row[d_bin] = incrementLoss(retention_row[d_bin], p, y)
                    }

                    // Calibration graph
                    if (!excludedRevlogIds.has(revlog.id)) {
                        let calibration_r_bin =
                            Math.floor(Math.exp(Math.log(calibration_bin_count + 1) * p)) - 1
                        calibration[calibration_r_bin] = incrementLoss(
                            calibration[calibration_r_bin],
                            p,
                            y
                        )
                        /* log.push({
                            d: card.difficulty,
                            s: card.stability,
                            id: revlog.id,
                            r: p,
                            y: 1,
                        }) */
                    }
                }

                fatigue_bins.not_learn[today_so_far] = incrementLoss(
                    fatigue_bins.not_learn[today_so_far],
                    p,
                    y
                )
                if (elapsed >= 21) {
                    card_type = fatigue_bins.mature
                } else {
                    card_type = fatigue_bins.young
                }
            } else {
                card_type = fatigue_bins.learn
            }
            card_type[today_so_far] = incrementLoss(card_type[today_so_far], p, y)

            today_so_far += 1
        }
        const newState = fsrs.next_state(memoryState, elapsed, grade)
        card.last_review = now
        card.stability = newState.stability
        card.difficulty = newState.difficulty
        last_stability[revlog.cid] = card.stability // To prevent "forget" affecting the forgetting curve
        const { step, bucket } = stabilityBucketForS90(card.stability)
        const s90_key = `${config.id}:${step}:${bucket}`
        s90_dedup_total += 1
        if (!s90_request_index_by_key.has(s90_key)) {
            s90_request_index_by_key.set(s90_key, s90_request_items.length)
            s90_request_items.push({
                config_id: config.id,
                stability: card.stability,
            })
        }
        const day_events = s90_events_by_day.get(revlogDay) ?? []
        day_events.push({
            card_id: revlog.cid,
            key: s90_key,
        })
        s90_events_by_day.set(revlogDay, day_events)

        fsrsCards[revlog.cid] = card
    }

    s90_deduped_total = Math.max(0, s90_dedup_total - s90_request_items.length)
    if (s90_request_items.length > 0) {
        s90_backend_calls = 1
        const intervals = await resolveS90Batch(s90_request_items, TARGET_RETRIEVABILITY)
        for (const [key, requestIndex] of s90_request_index_by_key) {
            const s90 = intervals[requestIndex]
            if (s90 !== undefined) {
                s90_by_key.set(key, s90)
            }
        }
    }

    const s90_key_by_card = new Map<number, string>()
    const s90_count_by_key = new Map<string, number>()
    for (let i = 0; i + 1 < review_days.length; i++) {
        const day = review_days[i]
        const events = s90_events_by_day.get(day) ?? []
        for (const event of events) {
            const previous_key = s90_key_by_card.get(event.card_id)
            if (previous_key) {
                incrementCount(s90_count_by_key, previous_key, -1)
            }
            s90_key_by_card.set(event.card_id, event.key)
            incrementCount(s90_count_by_key, event.key, 1)
        }
        const stats = dayStatsFromS90Counts(s90_count_by_key, s90_key_by_card.size)
        const nextDay = review_days[i + 1]
        for (let fillDay = day; fillDay < nextDay; fillDay++) {
            day_medians[fillDay] = stats.median
            day_means[fillDay] = stats.mean
            day_young_ratio_s90[fillDay] = stats.youngRatio
        }
    }

    // console.log(log)

    let inaccurate_cids: any[] = []
    let accurate_cids: number[] = []

    for (const [cid, card] of Object.entries(fsrsCards)) {
        const num_cid = +cid
        const previous = dayFromMs(card.last_review!.getTime())
        const fsrs = getFsrs(card_config(num_cid)!)
        forgetting_curve(fsrs, last_stability[num_cid], previous, today + 1, card, num_cid)
        const extra_data = cards_by_id[num_cid].data ? JSON.parse(cards_by_id[num_cid].data) : null
        if (extra_data?.s) {
            const expected = last_stability[num_cid]
            const actual = extra_data.s
            if (Math.abs(expected - actual) > 0.01) {
                inaccurate_cids.push({
                    cid: num_cid,
                    expected: expected.toFixed(2),
                    actual: actual.toFixed(2),
                })
            } else {
                accurate_cids.push(num_cid)
            }
        }
    }

    if (inaccurate_cids.length) {
        const mean_error = _.meanBy(inaccurate_cids, (a) =>
            Math.abs(a.expected - a.actual)
        ).toFixed(2)
        console.warn(
            `The stability of the following ${inaccurate_cids.length}/${
                inaccurate_cids.length + accurate_cids.length
            } cards differ between SSE and anki with a mean error of ${mean_error}:`,
            { inaccurate_cids, accurate_cids }
        )
    }

    const fatigueRMSE = _.mapValues(fatigue_bins, (bins) =>
        bins.map(
            ({ real, predicted, count }) =>
                [((real - predicted) / count) ** 2 * count, count] as LossBar
        )
    )

    const leech_probabilities = _.mapValues(probabilities, (p) =>
        p.length > leech_min_reviews ? _.sum(p) : 1
    )
    const s90_dedup_percent = s90_dedup_total > 0 ? (s90_deduped_total / s90_dedup_total) * 100 : 0
    console.log(
        `S90 dedup summary: ${s90_deduped_total}/${s90_dedup_total} (${s90_dedup_percent.toFixed(
            1
        )}%), backend calls: ${s90_backend_calls}`
    )
    console.timeEnd("Calculating memorised days")
    return {
        retrievabilityDays,
        totalCards,
        noteRetrievabilityDays,
        stable_retrievability_days,
        fatigueRMSE,
        bw_matrix: bw_matrix_count,
        stability_bins_days: stability_day_bins,
        day_medians,
        day_means,
        day_young_ratio_s90,
        leech_probabilities,
        difficulty_days: difficulty_day_bins,
        calibration,
    }
}
