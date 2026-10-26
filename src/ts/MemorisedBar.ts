import _ from "lodash"
import { dateDiffInDays } from "ts-fsrs"
import { ankiDaySnapshotMs } from "./ankiDay"
import type { LossBar } from "./bar"
import {
    type CalibrationBootstrapObservation,
    cardBootstrapConfidenceIntervals,
} from "./calibrationBootstrap"
import {
    CalibrationSampleBuilder,
    type CalibrationSamples,
    sampleCount,
} from "./calibrationSamples"
import { type CardData, getFsrsInternalStabilityFromCard, getFsrsS90FromCard } from "./cardData"
import type { DeckConfig, ResolvedFsrsPreset } from "./config"
import { DailyTransitions } from "./dailyTransitions"
import { prepareFsrsReplay } from "./fsrsHistory"
import {
    elapsedFsrsDays,
    type FsrsMemoryState,
    type FsrsModel,
    type FsrsSource,
    getFsrs,
    intervalAtRetrievability,
} from "./fsrsModel"
import { asRevlogHistory, type RevlogInput } from "./packedRevlogs"
import { type Buckets, dayFromMs, emptyBuckets, IDify, rollover_ms } from "./revlogGraphs"
import { bucketTimeStats, TimeBucketBuilder } from "./timeBucketStats"
export { getFsrs, intervalAtRetrievability } from "./fsrsModel"
type ReplayCard = FsrsMemoryState & { last_review?: Date; last_review_day?: number }

export interface LossBin {
    real: number
    predicted: number
    count: number
    confidenceInterval?: [number, number]
}

export const CALIBRATION_BIN_COUNT = 20

const default_bin = { predicted: 0, real: 0, count: 0 }

function incrementLoss(bin: LossBin | null | undefined, predicted: number, real: number) {
    bin ??= { ...default_bin }

    bin.predicted = (bin.predicted || 0) + predicted
    bin.real = (bin.real || 0) + real
    bin.count = (bin.count || 0) + 1

    return bin
}

function isValidProbability(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

export function calibrationBinIndex(predicted: number, binCount = CALIBRATION_BIN_COUNT) {
    return Math.max(
        0,
        Math.min(binCount - 1, Math.floor(Math.exp(Math.log(binCount + 1) * predicted)) - 1)
    )
}

export function addCalibrationSample(bins: LossBin[], predicted: number, actual: number) {
    if (!isValidProbability(predicted) || !isValidProbability(actual)) {
        return false
    }

    const bin = calibrationBinIndex(predicted, bins.length || CALIBRATION_BIN_COUNT)
    bins[bin] = incrementLoss(bins[bin], predicted, actual)
    return true
}

export function buildCalibrationBinCounts(
    samples: CalibrationSamples,
    predictions: Float64Array
): LossBin[] {
    const bins = <LossBin[]>Array(CALIBRATION_BIN_COUNT)
    for (let i = 0; i < sampleCount(samples); i++) {
        addCalibrationSample(bins, predictions[i], samples.actual[i])
    }
    return bins
}

export function calibrationConfidenceIntervals(
    samples: CalibrationSamples,
    predictions: Float64Array
): Array<[number, number] | undefined> {
    function* observations(): IterableIterator<CalibrationBootstrapObservation> {
        // A borrowed observation is consumed immediately by the card aggregator.
        const observation = { cardId: 0, bin: 0, actual: 0 }
        for (let i = 0; i < sampleCount(samples); i++) {
            const predicted = predictions[i]
            if (isValidProbability(predicted) && isValidProbability(samples.actual[i])) {
                observation.cardId = samples.cardIds[i]
                observation.bin = calibrationBinIndex(predicted)
                observation.actual = samples.actual[i]
                yield observation
            }
        }
    }
    return cardBootstrapConfidenceIntervals(observations(), CALIBRATION_BIN_COUNT)
}

export function withConfidenceIntervals(
    bins: LossBin[],
    intervals: Array<[number, number] | undefined>
): LossBin[] {
    return bins.map((bin, i) => ({
        ...bin,
        ...(intervals[i] ? { confidenceInterval: intervals[i] } : {}),
    }))
}

export function buildCalibrationBins(samples: CalibrationSamples, predictions: Float64Array) {
    return withConfidenceIntervals(
        buildCalibrationBinCounts(samples, predictions),
        calibrationConfidenceIntervals(samples, predictions)
    )
}

/**
 * Accurately implements the FSRS outlier filtering logic from the reference Rust code.
 * This function identifies cards whose first review interval is an outlier and returns
 * a set of all revlog IDs belonging to those cards.
 * @param revlogs The full list of review logs.
 * @returns A Set containing the IDs of all revlogs for cards deemed outliers.
 */
export function applyOutlierFilter(input: RevlogInput): Set<number> {
    const revlogs = asRevlogHistory(input)
    // Step 1: Group revlogs by card and identify the first review interval.
    // An "item" here represents a card's second review and its history.
    type SecondReviewItem = {
        cardId: number
        firstRating: number
        secondRating: number
        deltaT: number
    }
    const secondReviewItems: SecondReviewItem[] = []
    const firstReviews = new Map<number, number[]>()
    for (let index = 0; index < revlogs.length; index++) {
        const cid = revlogs.cid(index)
        let group = firstReviews.get(cid)
        if (!group) {
            group = []
            firstReviews.set(cid, group)
        }
        if (group.length < 3) group.push(index)
    }
    const row = revlogs.cursor()
    for (const [cardId, indices] of firstReviews) {
        if (indices.length < 3) continue
        row.index = indices[0]
        const firstRating = row.ease
        row.index = indices[1]
        const secondRating = row.ease,
            secondId = row.id
        row.index = indices[2]
        secondReviewItems.push({
            cardId,
            firstRating,
            secondRating,
            deltaT: dateDiffInDays(new Date(secondId), new Date(row.id)),
        })
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

type S90BatchItem = FsrsMemoryState & { card_id: number }

export type S90BatchResolver = (
    items: S90BatchItem[],
    targetRetrievability: number
) => Promise<number[]>

// Constants for B-W matrix
const R_BIN_POWER = 1.4
const LOG_R_BIN_POWER = Math.log(R_BIN_POWER)

function meanByReps(cards: CardData[], valueForCard: (card: CardData) => number | undefined) {
    const sums: number[] = []
    const counts: number[] = []

    for (const card of cards) {
        const value = valueForCard(card)
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
            continue
        }
        sums[card.reps] = (sums[card.reps] ?? 0) + value
        counts[card.reps] = (counts[card.reps] ?? 0) + 1
    }

    return sums.map((sum, reps) => sum / counts[reps])
}

export async function getMemorisedDays(
    input: RevlogInput,
    cards: CardData[],
    configs: typeof SSEother.deck_configs,
    config_mapping: typeof SSEother.deck_config_ids,
    last_forget: number[] = [],
    leech_elapsed_threshold = 2,
    leech_min_reviews = 2,
    fsrs_presets_by_card: Record<number, ResolvedFsrsPreset> = {},
    resolveS90Batch?: S90BatchResolver,
    snapshotNow = Date.now()
) {
    console.log("ts-fsrs upstream models (FSRS-6 / dual-trace FSRS-7)")

    // Apply the new outlier filtering logic at the start.
    console.time("Applying outlier filter")
    const revlogs = asRevlogHistory(input)
    const excludedRevlogIds = applyOutlierFilter(revlogs)
    console.timeEnd("Applying outlier filter")

    console.time("Calculating memorised days")
    let fsrsCards: Record<number, ReplayCard> = {}
    let cards_by_id = IDify(cards)

    const snapshotToday = dayFromMs(snapshotNow)
    const snapshotTimes = new Map<number, number>()
    function snapshotTime(day: number) {
        if (!snapshotTimes.has(day))
            snapshotTimes.set(day, ankiDaySnapshotMs(day, rollover_ms / 3600000, snapshotNow))
        return snapshotTimes.get(day)!
    }
    let retrievabilityDays: number[] = []
    let totalCards: number[] = []
    let noteRetrievabilityDays: number[] = []
    let stable_retrievability_days: number[] = []
    let reviewCountsByDay: number[] = []

    let cardCounts = cards.reduce(
        (p, c) => {
            p[c.nid] = (p[c.nid] ?? 0) + 1
            return p
        },
        <number[]>[]
    )

    function configDeckId(card: CardData) {
        return card.odid || card.did
    }

    function card_config(cid: number): DeckConfig | undefined {
        const card = cards_by_id[cid]
        if (!card) {
            return undefined
        }
        return configs[config_mapping[configDeckId(card)]]
    }

    function card_fsrs_source(cid: number): FsrsSource | undefined {
        const preset = fsrs_presets_by_card[cid]
        if (preset) {
            return preset
        }
        return card_config(cid)
    }

    let stability_day_bins: number[][] = []
    let difficulty_day_bins: number[][] = []

    let calibration = <LossBin[]>Array(CALIBRATION_BIN_COUNT)
    const calibration_samples = new CalibrationSampleBuilder(true)

    function forgetting_curve(
        fsrs: FsrsModel,
        state: FsrsMemoryState,
        from: number,
        to: number,
        card: ReplayCard,
        cid: number
    ) {
        for (let day = from; day < to; day++) {
            const elapsed =
                fsrs.version === "seven"
                    ? Math.max(0, (snapshotTime(day) - card.last_review!.getTime()) / 86400000)
                    : day - from
            const retrievability = fsrs.retrievability(state, elapsed)
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
                const stability_bin = Math.round(state.stability)
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
    const last_memory_state: Record<number, FsrsMemoryState> = {}
    let s90_by_key = new Map<number, number>()
    const local_s90_by_key = new Map<string, number>()
    let current_card_s90_by_cid = new Map<number, number>()
    const s90_events_by_day = new DailyTransitions()
    let s90_request_items: S90BatchItem[] = []
    let s90_request_index_by_key = new Map<string, number>()
    let s90_dedup_total = 0
    let s90_deduped_total = 0
    let s90_custom_resolver_calls = 0

    function incrementCount(map: Map<number, number>, key: number, delta: number) {
        const next = (map.get(key) ?? 0) + delta
        if (next > 0) {
            map.set(key, next)
        } else {
            map.delete(key)
        }
    }

    const s90SourceKeys = new Map<number, number>()
    const s90Sources = new Map<string, number>()
    function uncachedS90SourceKey(cid: number) {
        const source = card_fsrs_source(cid)
        if (!source) {
            return `card:${cid}`
        }
        if (Array.isArray((source as ResolvedFsrsPreset).params)) {
            return `params:${getFsrs(source).weights.join(",")}`
        }
        return `deck:${(source as DeckConfig).id}`
    }

    function s90SourceKey(cid: number) {
        if (!s90SourceKeys.has(cid)) {
            const signature = uncachedS90SourceKey(cid)
            if (!s90Sources.has(signature)) s90Sources.set(signature, s90Sources.size)
            s90SourceKeys.set(cid, s90Sources.get(signature)!)
        }
        return s90SourceKeys.get(cid)!
    }

    function queueS90Request(cardId: number, state: FsrsMemoryState, model: FsrsModel) {
        s90_dedup_total += 1
        // Exact FSRS-7 intervals need no retained state cache in the local path.
        if (!resolveS90Batch && state.stabilityFast !== undefined) {
            return intervalAtRetrievability(model, state, TARGET_RETRIEVABILITY)
        }
        const { step, bucket } = stabilityBucketForS90(state.stability)
        const stateKey =
            state.stabilityFast === undefined
                ? `${step}:${bucket}`
                : `${state.stability}:${state.stabilityFast}:${state.difficulty}`
        const s90_key = `${s90SourceKey(cardId)}:${stateKey}`
        if (!resolveS90Batch) {
            if (!local_s90_by_key.has(s90_key)) {
                local_s90_by_key.set(
                    s90_key,
                    intervalAtRetrievability(model, state, TARGET_RETRIEVABILITY)
                )
            } else s90_deduped_total += 1
            return local_s90_by_key.get(s90_key)!
        }
        if (!s90_request_index_by_key.has(s90_key)) {
            s90_request_index_by_key.set(s90_key, s90_request_items.length)
            s90_request_items.push({
                card_id: cardId,
                ...state,
            })
        } else s90_deduped_total += 1
        return s90_request_index_by_key.get(s90_key)!
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

    function dayStatsFromS90Counts(counts: Map<number, number>, totalCount: number) {
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
            const s90 = resolveS90Batch ? (s90_by_key.get(key) ?? 0) : key
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

    let fatigue_bins: Buckets<LossBin[]> = emptyBuckets(() => [])
    let today_so_far = 0
    let last_date = new Date()

    let bw_matrix_count: Record<number, LossBin[]> = {}
    let day_medians: number[] = []
    let day_means: number[] = []
    let day_young_ratio_s90: number[] = []
    let review_days: number[] = []
    const uniqueCids = new Set<number>()
    for (const review of revlogs) {
        uniqueCids.add(review.cid)
        if (review.ease <= 0 || review.id > snapshotNow) continue
        const reviewDay = dayFromMs(review.id)
        if (reviewDay <= snapshotToday)
            reviewCountsByDay[reviewDay] = (reviewCountsByDay[reviewDay] ?? 0) + 1
    }
    let probabilities: Record<number, number[]> = {}
    const timeSamples = new TimeBucketBuilder(6)
    for (const cid of uniqueCids) probabilities[cid] = [1]

    const replay = prepareFsrsReplay(revlogs, card_fsrs_source)
    for (const { review: revlog, model: fsrs, startingState, reset } of replay) {
        const grade = revlog.ease
        const now = new Date(revlog.id)
        const revlogDay = dayFromMs(revlog.id)
        if (revlogDay > snapshotToday || revlog.id > snapshotNow) continue
        let card = fsrsCards[revlog.cid] ?? { stability: 0, difficulty: 0 }
        if (review_days.length === 0 || review_days[review_days.length - 1] !== revlogDay)
            review_days.push(revlogDay)
        if (last_memory_state[revlog.cid] && card.last_review) {
            forgetting_curve(
                fsrs,
                last_memory_state[revlog.cid],
                card.last_review_day!,
                revlogDay,
                card,
                revlog.cid
            )
        }
        if (reset) {
            delete fsrsCards[revlog.cid]
            delete last_memory_state[revlog.cid]
            delete last_stability[revlog.cid]
            card = { stability: 0, difficulty: 0 }
            probabilities[revlog.cid] = [1]
        }
        if (grade === 0) {
            s90_events_by_day.set(revlogDay, revlog.cid, null)
            continue
        }
        const new_card = !fsrsCards[revlog.cid]
        let memoryState: FsrsMemoryState | null = null
        let elapsed = 0
        if (card.last_review && card.stability > 0) {
            memoryState = card
            elapsed = elapsedFsrsDays(fsrs, card.last_review, now, rollover_ms)
            const newDate = new Date(now.getTime() - rollover_ms)
            newDate.setHours(0, 0, 0, 0)

            if (newDate.getTime() != last_date.getTime()) {
                today_so_far = 0
                last_date = newDate
            }

            const p = fsrs.retrievability(card, elapsed)
            if (revlog.time > 0 && card.stability > 0) {
                const seconds = revlog.time / 1000
                const retrievabilityBucket = Math.max(0, Math.min(99, Math.floor(p * 100)))
                const stabilityBucket = Math.max(0, Math.round(card.stability))
                const difficultyBucket = Math.max(
                    0,
                    Math.min(99, Math.round(card.difficulty * 10) - 1)
                )
                const isSameDay = elapsed < 1
                const isSuccess = grade > 1

                timeSamples.add(seconds, [
                    retrievabilityBucket,
                    !isSameDay ? retrievabilityBucket : undefined,
                    isSuccess ? retrievabilityBucket : undefined,
                    isSuccess && !isSameDay ? retrievabilityBucket : undefined,
                    stabilityBucket,
                    difficultyBucket,
                ])
            }
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
                        calibration_samples.add(revlog.id, revlog.cid, y, p)
                        addCalibrationSample(calibration, p, y)
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
        const newState = startingState ?? fsrs.nextState(memoryState, elapsed, grade)
        card = { ...newState, last_review: now, last_review_day: revlogDay }
        last_memory_state[revlog.cid] = newState
        last_stability[revlog.cid] = card.stability // To prevent "forget" affecting the forgetting curve
        const s90_key = queueS90Request(revlog.cid, newState, fsrs)
        s90_events_by_day.set(revlogDay, revlog.cid, s90_key)

        fsrsCards[revlog.cid] = card
    }

    for (const card of cards) {
        const stability = getFsrsS90FromCard(card)
        if (stability === undefined) {
            continue
        }
        current_card_s90_by_cid.set(card.id, stability)
    }

    if (resolveS90Batch && s90_request_items.length > 0) {
        const intervals = await resolveS90Batch(s90_request_items, TARGET_RETRIEVABILITY)
        s90_custom_resolver_calls = 1
        for (const requestIndex of s90_request_index_by_key.values()) {
            const s90 = intervals[requestIndex]
            if (s90 !== undefined) {
                s90_by_key.set(requestIndex, s90)
            }
        }
    }

    const s90_key_by_card = new Map<number, number>()
    const s90_count_by_key = new Map<number, number>()
    for (let i = 0; i < review_days.length; i++) {
        const day = review_days[i]
        for (const [card_id, key] of s90_events_by_day.entries(day)) {
            const previous_key = s90_key_by_card.get(card_id)
            if (previous_key !== undefined) {
                incrementCount(s90_count_by_key, previous_key, -1)
            }
            if (key === null) s90_key_by_card.delete(card_id)
            else {
                s90_key_by_card.set(card_id, key)
                incrementCount(s90_count_by_key, key, 1)
            }
        }
        const stats = dayStatsFromS90Counts(s90_count_by_key, s90_key_by_card.size)
        const nextDay = review_days[i + 1] ?? snapshotToday + 1
        for (let fillDay = day; fillDay < nextDay; fillDay++) {
            day_medians[fillDay] = stats.median
            day_means[fillDay] = stats.mean
            day_young_ratio_s90[fillDay] = stats.youngRatio
        }
    }

    s90_events_by_day.release()

    // console.log(log)

    let comparedStabilityCount = 0
    let inaccurateStabilityCount = 0
    let stabilityErrorSum = 0
    const inaccurateStabilitySample: {
        cid: number
        expected: string
        actual: string
    }[] = []
    const inaccurateStabilitySampleLimit = 20

    for (const [cid, card] of Object.entries(fsrsCards)) {
        const num_cid = +cid
        const previous = card.last_review_day!
        const source = card_fsrs_source(num_cid)
        if (!source) {
            continue
        }
        const fsrs = getFsrs(source)
        forgetting_curve(
            fsrs,
            last_memory_state[num_cid],
            previous,
            snapshotToday + 1,
            card,
            num_cid
        )
        const actual = getFsrsInternalStabilityFromCard(cards_by_id[num_cid])
        if (actual !== undefined) {
            comparedStabilityCount += 1
            const expected = last_stability[num_cid]
            const error = Math.abs(expected - actual)
            if (error > 0.01) {
                inaccurateStabilityCount += 1
                stabilityErrorSum += error
                if (inaccurateStabilitySample.length < inaccurateStabilitySampleLimit) {
                    inaccurateStabilitySample.push({
                        cid: num_cid,
                        expected: expected.toFixed(2),
                        actual: actual.toFixed(2),
                    })
                }
            }
        }
    }

    if (inaccurateStabilityCount) {
        const mean_error = (stabilityErrorSum / inaccurateStabilityCount).toFixed(2)
        console.warn(
            `The stability of ${inaccurateStabilityCount}/${comparedStabilityCount} cards differs between SSE and Anki with a mean error of ${mean_error}. Showing up to ${inaccurateStabilitySampleLimit} examples:`,
            {
                inaccurate_cids: inaccurateStabilitySample,
                omitted_inaccurate_cids:
                    inaccurateStabilityCount - inaccurateStabilitySample.length,
            }
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
        `S90 card-preset dedup summary: ${s90_deduped_total}/${s90_dedup_total} (${s90_dedup_percent.toFixed(
            1
        )}%), custom resolver calls: ${s90_custom_resolver_calls}, resolver: ${
            resolveS90Batch ? "custom" : "local"
        }`
    )
    const [
        time_by_retrievability_samples,
        time_by_retrievability_samples_exclude_same_day,
        time_by_retrievability_samples_success_only,
        time_by_retrievability_samples_success_only_exclude_same_day,
        time_by_stability_samples,
        time_by_difficulty_samples,
    ] = timeSamples.finish()
    const retrievabilityTimeStats = bucketTimeStats(time_by_retrievability_samples)
    const retrievabilityTimeStatsExcludeSameDay = bucketTimeStats(
        time_by_retrievability_samples_exclude_same_day
    )
    const retrievabilityTimeStatsSuccessOnly = bucketTimeStats(
        time_by_retrievability_samples_success_only
    )
    const retrievabilityTimeStatsSuccessOnlyExcludeSameDay = bucketTimeStats(
        time_by_retrievability_samples_success_only_exclude_same_day
    )
    const stabilityTimeStats = bucketTimeStats(time_by_stability_samples)
    const difficultyTimeStats = bucketTimeStats(time_by_difficulty_samples)
    const averageStabilityByReps = meanByReps(cards, (card) => {
        return current_card_s90_by_cid.get(card.id)
    })
    const averageIntervalByReps = meanByReps(cards, (card) => card.ivl)
    const collectedCalibration = calibration_samples.finish()
    console.timeEnd("Calculating memorised days")
    return {
        retrievabilityDays,
        reviewCountsByDay,
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
        calibration_samples: collectedCalibration.samples,
        fsrs_calibration_replay_predictions: collectedCalibration.predictions,
        time_by_retrievability_samples,
        time_by_retrievability_samples_exclude_same_day,
        time_by_retrievability_samples_success_only,
        time_by_retrievability_samples_success_only_exclude_same_day,
        time_by_stability_samples,
        time_by_difficulty_samples,
        time_by_retrievability_mean: retrievabilityTimeStats.meanByBucket,
        time_by_retrievability_median: retrievabilityTimeStats.medianByBucket,
        time_by_retrievability_mean_exclude_same_day:
            retrievabilityTimeStatsExcludeSameDay.meanByBucket,
        time_by_retrievability_median_exclude_same_day:
            retrievabilityTimeStatsExcludeSameDay.medianByBucket,
        time_by_retrievability_mean_success_only: retrievabilityTimeStatsSuccessOnly.meanByBucket,
        time_by_retrievability_median_success_only:
            retrievabilityTimeStatsSuccessOnly.medianByBucket,
        time_by_retrievability_mean_success_only_exclude_same_day:
            retrievabilityTimeStatsSuccessOnlyExcludeSameDay.meanByBucket,
        time_by_retrievability_median_success_only_exclude_same_day:
            retrievabilityTimeStatsSuccessOnlyExcludeSameDay.medianByBucket,
        time_by_stability_mean: stabilityTimeStats.meanByBucket,
        time_by_stability_median: stabilityTimeStats.medianByBucket,
        time_by_difficulty_mean: difficultyTimeStats.meanByBucket,
        time_by_difficulty_median: difficultyTimeStats.medianByBucket,
        average_stability_by_reps: averageStabilityByReps,
        average_interval_by_reps: averageIntervalByReps,
    }
}
