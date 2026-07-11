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
import {
    cardBootstrapConfidenceIntervals,
    type CalibrationBootstrapObservation,
} from "./calibrationBootstrap"
import type { DeckConfig, ResolvedFsrsPreset } from "./config"
import { paramsForTsFsrs, selectResolvedFsrsPresetParams, selectTsFsrsParams } from "./fsrsParams"
import { type Buckets, dayFromMs, emptyBuckets, IDify, rollover_ms, today } from "./revlogGraphs"
import {
    type CardData,
    getFsrsInternalStabilityFromCard,
    getFsrsS90FromCard,
    type Revlog,
} from "./search"

export interface LossBin {
    real: number
    predicted: number
    count: number
    confidenceInterval?: [number, number]
}

export type CalibrationSample = {
    revlogId: number
    cardId: number
    actual: number
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

export function buildCalibrationBins(
    samples: CalibrationSample[],
    predictionsByRevlogId: Record<number, number>
) {
    const bins = <LossBin[]>Array(CALIBRATION_BIN_COUNT)
    const observations: CalibrationBootstrapObservation[] = []

    for (const sample of samples) {
        const predicted = predictionsByRevlogId[sample.revlogId]
        if (addCalibrationSample(bins, predicted, sample.actual)) {
            observations.push({
                cardId: sample.cardId,
                bin: calibrationBinIndex(predicted),
                actual: sample.actual,
            })
        }
    }

    const confidenceIntervals = cardBootstrapConfidenceIntervals(
        observations,
        CALIBRATION_BIN_COUNT
    )
    for (let bin = 0; bin < bins.length; bin++) {
        if (bins[bin] && confidenceIntervals[bin]) {
            bins[bin].confidenceInterval = confidenceIntervals[bin]
        }
    }

    return bins
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

type FsrsSource = DeckConfig | ResolvedFsrsPreset

function isResolvedPreset(source: FsrsSource): source is ResolvedFsrsPreset {
    return "params" in source
}

let deckFsrs: Record<string, { signature: string; model: FSRS }> = {}
export function getFsrs(source: FsrsSource) {
    const id = isResolvedPreset(source) ? `preset:${source.id}` : `deck:${source.id}`
    const params = isResolvedPreset(source)
        ? selectResolvedFsrsPresetParams(source)
        : selectTsFsrsParams(source)
    const signature = `${params.length}:${params.join(",")}`
    if (!deckFsrs[id] || deckFsrs[id].signature !== signature) {
        deckFsrs[id] = {
            signature,
            model: Fsrs(
                generatorParameters({
                    w: checkParameters(paramsForTsFsrs(params)),
                    enable_fuzz: false,
                    enable_short_term: true,
                })
            ),
        }
    }
    return deckFsrs[id].model
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
    card_id: number
    stability: number
}

export type S90BatchResolver = (
    items: S90BatchItem[],
    targetRetrievability: number
) => Promise<number[]>

export function intervalAtRetrievability(
    fsrs: FSRS,
    stability: number,
    targetRetrievability: number
): number {
    const target = Math.max(0.0001, Math.min(0.9999, targetRetrievability))
    let low = 0
    let high = Math.max(stability, 1)
    while (fsrs.forgetting_curve(high, stability) > target && high < 36500) {
        high = Math.min(high * 2, 36500)
    }
    for (let i = 0; i < 50; i++) {
        const mid = (low + high) / 2
        if (fsrs.forgetting_curve(mid, stability) > target) {
            low = mid
        } else {
            high = mid
        }
    }
    return (low + high) / 2
}

// Constants for B-W matrix
const R_BIN_POWER = 1.4
const LOG_R_BIN_POWER = Math.log(R_BIN_POWER)

function median(values: number[]) {
    if (!values.length) {
        return 0
    }
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    if (sorted.length % 2 === 1) {
        return sorted[middle]
    }
    return (sorted[middle - 1] + sorted[middle]) / 2
}

function bucketTimeStats(bucketedSamples: number[][]) {
    const meanByBucket: number[] = []
    const medianByBucket: number[] = []

    bucketedSamples.forEach((samples, bucket) => {
        if (!samples?.length) {
            return
        }
        meanByBucket[bucket] = _.sum(samples) / samples.length
        medianByBucket[bucket] = median(samples)
    })

    return { meanByBucket, medianByBucket }
}

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
    revlogs: Revlog[],
    cards: CardData[],
    configs: typeof SSEother.deck_configs,
    config_mapping: typeof SSEother.deck_config_ids,
    last_forget: number[] = [],
    leech_elapsed_threshold = 2,
    leech_min_reviews = 2,
    fsrs_presets_by_card: Record<number, ResolvedFsrsPreset> = {},
    resolveS90Batch?: S90BatchResolver
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
    let calibration_samples: CalibrationSample[] = []
    let fsrs_calibration_predictions_by_revlog_id: Record<number, number> = {}

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
    let current_card_s90_by_cid = new Map<number, number>()
    let s90_events_by_day = new Map<number, { card_id: number; key: string }[]>()
    let s90_request_items: S90BatchItem[] = []
    let s90_request_index_by_key = new Map<string, number>()
    let s90_dedup_total = 0
    let s90_deduped_total = 0
    let s90_custom_resolver_calls = 0

    function incrementCount(map: Map<string, number>, key: string, delta: number) {
        const next = (map.get(key) ?? 0) + delta
        if (next > 0) {
            map.set(key, next)
        } else {
            map.delete(key)
        }
    }

    function s90SourceKey(cid: number) {
        const source = card_fsrs_source(cid)
        if (!source) {
            return `card:${cid}`
        }
        if (Array.isArray((source as ResolvedFsrsPreset).params)) {
            return `preset:${(source as ResolvedFsrsPreset).id}`
        }
        return `deck:${(source as DeckConfig).id}`
    }

    function queueS90Request(cardId: number, stability: number) {
        const { step, bucket } = stabilityBucketForS90(stability)
        const s90_key = `${s90SourceKey(cardId)}:${step}:${bucket}`
        s90_dedup_total += 1
        if (!s90_request_index_by_key.has(s90_key)) {
            s90_request_index_by_key.set(s90_key, s90_request_items.length)
            s90_request_items.push({
                card_id: cardId,
                stability,
            })
        }
        return s90_key
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
    let time_by_retrievability_samples: number[][] = []
    let time_by_retrievability_samples_exclude_same_day: number[][] = []
    let time_by_retrievability_samples_success_only: number[][] = []
    let time_by_retrievability_samples_success_only_exclude_same_day: number[][] = []
    let time_by_stability_samples: number[][] = []
    let time_by_difficulty_samples: number[][] = []
    for (const cid of uniqueCids) probabilities[cid] = [1]

    // let log: any[] = []
    for (const revlog of revlogs) {
        const fsrsSource = card_fsrs_source(revlog.cid)
        if (!fsrsSource) {
            continue
        }

        const grade = revlog.ease
        const new_card = !fsrsCards[revlog.cid]
        const now = new Date(revlog.id)
        const fsrs = getFsrs(fsrsSource)
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

                time_by_retrievability_samples[retrievabilityBucket] ??= []
                time_by_retrievability_samples[retrievabilityBucket].push(seconds)
                if (!isSameDay) {
                    time_by_retrievability_samples_exclude_same_day[retrievabilityBucket] ??= []
                    time_by_retrievability_samples_exclude_same_day[retrievabilityBucket].push(
                        seconds
                    )
                }
                if (isSuccess) {
                    time_by_retrievability_samples_success_only[retrievabilityBucket] ??= []
                    time_by_retrievability_samples_success_only[retrievabilityBucket].push(seconds)
                }
                if (isSuccess && !isSameDay) {
                    time_by_retrievability_samples_success_only_exclude_same_day[
                        retrievabilityBucket
                    ] ??= []
                    time_by_retrievability_samples_success_only_exclude_same_day[
                        retrievabilityBucket
                    ].push(seconds)
                }
                time_by_stability_samples[stabilityBucket] ??= []
                time_by_stability_samples[stabilityBucket].push(seconds)
                time_by_difficulty_samples[difficultyBucket] ??= []
                time_by_difficulty_samples[difficultyBucket].push(seconds)
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
                        calibration_samples.push({
                            revlogId: revlog.id,
                            cardId: revlog.cid,
                            actual: y,
                        })
                        fsrs_calibration_predictions_by_revlog_id[revlog.id] = p
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
        const newState = fsrs.next_state(memoryState, elapsed, grade)
        card.last_review = now
        card.stability = newState.stability
        card.difficulty = newState.difficulty
        last_stability[revlog.cid] = card.stability // To prevent "forget" affecting the forgetting curve
        const s90_key = queueS90Request(revlog.cid, card.stability)
        const day_events = s90_events_by_day.get(revlogDay) ?? []
        day_events.push({
            card_id: revlog.cid,
            key: s90_key,
        })
        s90_events_by_day.set(revlogDay, day_events)

        fsrsCards[revlog.cid] = card
    }

    for (const card of cards) {
        const stability = getFsrsS90FromCard(card)
        if (stability === undefined) {
            continue
        }
        current_card_s90_by_cid.set(card.id, stability)
    }

    s90_deduped_total = Math.max(0, s90_dedup_total - s90_request_items.length)
    if (s90_request_items.length > 0) {
        const intervals = resolveS90Batch
            ? await resolveS90Batch(s90_request_items, TARGET_RETRIEVABILITY)
            : s90_request_items.map((item) => {
                  const source = card_fsrs_source(item.card_id)
                  if (!source) {
                      return 0
                  }
                  return intervalAtRetrievability(
                      getFsrs(source),
                      item.stability,
                      TARGET_RETRIEVABILITY
                  )
              })
        s90_custom_resolver_calls = resolveS90Batch ? 1 : 0
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
        const previous = dayFromMs(card.last_review!.getTime())
        const source = card_fsrs_source(num_cid)
        if (!source) {
            continue
        }
        const fsrs = getFsrs(source)
        forgetting_curve(fsrs, last_stability[num_cid], previous, today + 1, card, num_cid)
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
        calibration_samples,
        fsrs_calibration_predictions_by_revlog_id,
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
