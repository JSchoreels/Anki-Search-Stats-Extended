import _ from "lodash"
import { FSRS5_DEFAULT_DECAY } from "ts-fsrs"
import { ankiDayFromMs, ankiDayToMs } from "./ankiDay"
import type { BarChart, BarDatum } from "./bar"
import { totalCalc } from "./barHelpers"
import { getCardDecay, type CardData, type Revlog } from "./cardData"
import type { ResolvedFsrsPreset } from "./config"
import {
    averageDecay,
    type ForgettingCurveDecayModel,
    type ForgettingSample,
} from "./forgettingCurveData"
import { prepareFsrsReplay } from "./fsrsHistory"
import { elapsedFsrsDays, type FsrsMemoryState } from "./fsrsModel"
import { selectResolvedFsrsPresetParams, selectTsFsrsParams } from "./fsrsParams"
import { i18n } from "./i18n"
import { asRevlogHistory, type RevlogHistory, type RevlogInput } from "./packedRevlogs"
import { TimeBucketBuilder, bucketTimeStats, type TimeBuckets } from "./timeBucketStats"
type ReplayCard = FsrsMemoryState & { last_review?: Date }

const rollover = SSEother.rollover ?? 0
export const rollover_ms = rollover * 60 * 60 * 1000
export const day_ms = 1000 * 60 * 60 * 24
const date_only_re = /^\d{4}-\d{2}-\d{2}$/

export function dayFromMs(ms: number) {
    return ankiDayFromMs(ms, rollover)
}
export function dayToMs(day: number) {
    return ankiDayToMs(day, rollover)
}
export function dayToDateString(day: number) {
    return new Date(day * day_ms).toISOString().slice(0, 10)
}
export function dayFromDateString(date: string) {
    if (!date_only_re.test(date)) return
    const ms = Date.parse(`${date}T00:00:00Z`)
    if (Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date) return ms / day_ms
}

export const today = dayFromMs(Date.now())
export function calendarDayFromMs(ms: number) {
    const date = new Date(ms)
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / day_ms
}

export const no_rollover_today = calendarDayFromMs(Date.now())
const stability_maturity_threshold = 21

function forgettingCurveModelsForCards(
    cids: Set<number>,
    cards: Record<number, CardData>,
    presets: Record<number, ResolvedFsrsPreset>
): ForgettingCurveDecayModel {
    const models: (number | readonly number[])[] = []
    const bySignature = new Map<string, number>()
    const cardModels: Record<number, number> = {}
    for (const cid of cids) {
        const card = cards[cid]
        const preset = presets[cid]
        const config = card
            ? SSEother.deck_configs?.[SSEother.deck_config_ids?.[card.odid || card.did]]
            : undefined
        const model = preset
            ? selectResolvedFsrsPresetParams(preset)
            : config
              ? selectTsFsrsParams(config)
              : card
                ? getCardDecay(card)
                : FSRS5_DEFAULT_DECAY
        const signature = JSON.stringify(model)
        if (!bySignature.has(signature)) {
            bySignature.set(signature, models.length)
            models.push(model)
        }
        cardModels[cid] = bySignature.get(signature)!
    }
    if (models.length < 2) return models[0] ?? FSRS5_DEFAULT_DECAY
    return { models, cards: cardModels }
}

type FSRSReplayStats = {
    stabilityByRevlog: Float64Array
    timeByRetrievabilitySamples: TimeBuckets
    timeByStabilitySamples: TimeBuckets
    gradeByRetrievability: number[][]
    gradeByRetrievabilityExcludeSameDay: number[][]
    gradeByRetrievabilitySuccessOnly: number[][]
    gradeByRetrievabilitySuccessOnlyExcludeSameDay: number[][]
    gradeByStability: number[][]
    gradeByStabilitySuccessOnly: number[][]
    gradeByDifficulty: number[][]
    gradeByDifficultySuccessOnly: number[][]
}

function stabilityAfterReviewsByRevlog(
    revlogData: RevlogHistory,
    id_card_data: Record<number, CardData>,
    presets: Record<number, ResolvedFsrsPreset>
): FSRSReplayStats {
    const stabilityByRevlog = new Float64Array(revlogData.length).fill(NaN)
    const timeSamples = new TimeBucketBuilder(2)
    const gradeByRetrievability: number[][] = []
    const gradeByRetrievabilityExcludeSameDay: number[][] = []
    const gradeByRetrievabilitySuccessOnly: number[][] = []
    const gradeByRetrievabilitySuccessOnlyExcludeSameDay: number[][] = []
    const gradeByStability: number[][] = []
    const gradeByStabilitySuccessOnly: number[][] = []
    const gradeByDifficulty: number[][] = []
    const gradeByDifficultySuccessOnly: number[][] = []
    const deckConfigs = SSEother.deck_configs
    const deckConfigIds = SSEother.deck_config_ids

    function incrementGrade(ease: number, buckets: number[][], bucket: number) {
        if (ease < 0 || ease > 3) {
            return
        }
        buckets[bucket] ??= [0, 0, 0, 0]
        buckets[bucket][ease] += 1
    }

    if (!deckConfigs || !deckConfigIds) {
        const [timeByRetrievabilitySamples, timeByStabilitySamples] = timeSamples.finish()
        return {
            stabilityByRevlog,
            timeByRetrievabilitySamples,
            timeByStabilitySamples,
            gradeByRetrievability,
            gradeByRetrievabilityExcludeSameDay,
            gradeByRetrievabilitySuccessOnly,
            gradeByRetrievabilitySuccessOnlyExcludeSameDay,
            gradeByStability,
            gradeByStabilitySuccessOnly,
            gradeByDifficulty,
            gradeByDifficultySuccessOnly,
        }
    }

    const fsrsCards: Record<number, ReplayCard> = {}

    const sourceForCard = (cid: number) => {
        const card = id_card_data[cid]
        return (
            presets[cid] ?? (card ? deckConfigs[deckConfigIds[card.odid || card.did]] : undefined)
        )
    }
    for (const { review: revlog, model: fsrs, startingState, reset, index } of prepareFsrsReplay(
        revlogData,
        sourceForCard
    )) {
        const now = new Date(revlog.id)
        if (reset) delete fsrsCards[revlog.cid]
        if (revlog.ease === 0) continue
        let card = fsrsCards[revlog.cid] ?? { stability: 0, difficulty: 0 }
        let memoryState: FsrsMemoryState | null = null
        let elapsed = 0
        if (card.last_review && card.stability > 0) {
            memoryState = card
            elapsed = elapsedFsrsDays(fsrs, card.last_review, now, rollover_ms)

            if (revlog.time > 0 && card.stability > 0) {
                const seconds = revlog.time / 1000
                const retrievability = fsrs.retrievability(card, elapsed)
                const retrievabilityBucket = Math.max(
                    0,
                    Math.min(99, Math.floor(retrievability * 100))
                )
                const stabilityBucket = Math.max(0, Math.round(card.stability))

                timeSamples.add(seconds, [retrievabilityBucket, stabilityBucket])
            }

            const retrievability = fsrs.retrievability(card, elapsed)
            const retrievabilityBucket = Math.max(0, Math.min(99, Math.floor(retrievability * 100)))
            const stabilityBucket = Math.max(0, Math.round(card.stability))
            const difficultyBucket = Math.max(0, Math.min(99, Math.round(card.difficulty * 10) - 1))
            const isSameDay = elapsed < 1
            const isSuccess = revlog.ease > 1
            incrementGrade(revlog.ease - 1, gradeByRetrievability, retrievabilityBucket)
            if (!isSameDay) {
                incrementGrade(
                    revlog.ease - 1,
                    gradeByRetrievabilityExcludeSameDay,
                    retrievabilityBucket
                )
            }
            if (isSuccess) {
                incrementGrade(
                    revlog.ease - 1,
                    gradeByRetrievabilitySuccessOnly,
                    retrievabilityBucket
                )
            }
            if (isSuccess && !isSameDay) {
                incrementGrade(
                    revlog.ease - 1,
                    gradeByRetrievabilitySuccessOnlyExcludeSameDay,
                    retrievabilityBucket
                )
            }
            incrementGrade(revlog.ease - 1, gradeByStability, stabilityBucket)
            if (isSuccess) {
                incrementGrade(revlog.ease - 1, gradeByStabilitySuccessOnly, stabilityBucket)
            }
            incrementGrade(revlog.ease - 1, gradeByDifficulty, difficultyBucket)
            if (isSuccess) {
                incrementGrade(revlog.ease - 1, gradeByDifficultySuccessOnly, difficultyBucket)
            }
        }

        const newState = startingState ?? fsrs.nextState(memoryState, elapsed, revlog.ease)
        card = { ...newState, last_review: now }
        fsrsCards[revlog.cid] = card
        stabilityByRevlog[index] = card.stability
    }

    const [timeByRetrievabilitySamples, timeByStabilitySamples] = timeSamples.finish()
    return {
        stabilityByRevlog,
        timeByRetrievabilitySamples,
        timeByStabilitySamples,
        gradeByRetrievability,
        gradeByRetrievabilityExcludeSameDay,
        gradeByRetrievabilitySuccessOnly,
        gradeByRetrievabilitySuccessOnlyExcludeSameDay,
        gradeByStability,
        gradeByStabilitySuccessOnly,
        gradeByDifficulty,
        gradeByDifficultySuccessOnly,
    }
}

interface SiblingReview {
    cid: number
    day: number
}

export type Buckets<T> = {
    learn: T
    young: T
    mature: T
    not_learn: T
    all: T
}

export function emptyBuckets<T>(init: () => T): Buckets<T> {
    return {
        learn: init(),
        not_learn: init(),
        young: init(),
        mature: init(),
        all: init(),
    }
}

export type RevlogBuckets = Buckets<number[][]>

export function IDify<T extends { id: number }>(array: T[]) {
    let id_data: Record<number, T> = {}
    for (const e of array) {
        id_data[e.id] = e
    }
    return id_data
}

function isForget(revlog?: Revlog) {
    return revlog && revlog.factor == 0 && revlog.type == 4
}

function isCram(revlog?: Revlog) {
    return revlog && revlog.factor == 0 && revlog.type == 3
}

export function calculateRevlogStats(
    input: RevlogInput,
    cardData: CardData[],
    end: number = today,
    presets: Record<number, ResolvedFsrsPreset> = {}
) {
    console.time("revlog stats")
    let id_card_data = IDify(cardData)
    const revlogData = asRevlogHistory(input)
    const fsrsReplayStats = stabilityAfterReviewsByRevlog(revlogData, id_card_data, presets)
    const stability_after_review = fsrsReplayStats.stabilityByRevlog

    function emptyArray<T>(init: T): T[] {
        const empty_array: T[] = []
        empty_array[end] = init
        return empty_array
    }

    function initialEase() {
        return [0, 0, 0, 0]
    }

    function emptyRevlogBuckets(): RevlogBuckets {
        return emptyBuckets(() => emptyArray(initialEase()))
    }

    const empty_2d_array = []
    empty_2d_array[end] = []

    let revlog_times: number[] = emptyArray(0)
    let introduced_day_count: number[] = emptyArray(0)
    let introduced_load_by_day: number[] = emptyArray(0)
    let reintroduced_day_count: number[] = emptyArray(0)
    let day_forgotten: number[] = emptyArray(0)
    let active_cards_all_by_day: number[] = emptyArray(0)
    let active_cards_young_by_day: number[] = emptyArray(0)
    let active_cards_mature_by_day: number[] = emptyArray(0)
    let suspended_active_cards_all_by_day: number[] = emptyArray(0)
    let suspended_active_cards_young_by_day: number[] = emptyArray(0)
    let suspended_active_cards_mature_by_day: number[] = emptyArray(0)

    let intervals: number[][] = []
    let burden: number[] = []

    let day_initial_ease: number[][] = emptyArray(initialEase())
    let day_initial_reintroduced_ease: number[][] = emptyArray(initialEase())
    let interval_ease = emptyArray(initialEase())
    let day_review_hours = emptyArray(Array(24).fill(0))
    let day_filtered_review_hours = emptyArray(Array(24).fill(0))

    let day_ease = emptyRevlogBuckets()
    let day_ease_time = emptyRevlogBuckets()
    let fatigue_ease = emptyRevlogBuckets()
    let time_ease_seconds = emptyRevlogBuckets()

    let forgotten = new Set<number>()
    let card_times: Record<number, number> = {}
    let introduced = new Set<number>()
    let reintroduced = new Set<number>()
    let card_introduction_day: Record<number, number> = {}
    let last_cids: Record<number, number> = {}
    let next_review_was_reset: Record<number, boolean> = {}

    let last_siblings: (undefined | SiblingReview)[] = []
    let sibling_time_ease: number[][] = emptyArray(initialEase())
    let day_review_count: number[] = []
    let last_forget = []

    let learn_steps_per_card: Record<number, number> = {}
    let first_rating: Record<number, number | undefined> = {}
    let first_rating_day: Record<number, number | undefined> = {}
    let first_rating_time: Record<number, number | undefined> = {}
    let recorded_cards: Set<number> = new Set()
    let short_term_recorded_cards: Set<number> = new Set()
    let forgetting_samples: ForgettingSample[] = []
    let forgetting_samples_short: ForgettingSample[] = []
    const repetitionSamples = new TimeBucketBuilder(1)
    let gradeByRepetitions: number[][] = []
    let gradeByRepetitionsSuccessOnly: number[][] = []
    let repetitionsByCard: Record<number, number> = {}

    function incrementEase(ease_array: number[][], day: number, ease: number, amount = 1) {
        if (ease < 0 || ease > 3) {
            return
        }
        ease_array[day] = ease_array[day] ? ease_array[day] : initialEase()
        ease_array[day][ease] += amount
    }

    function incrementActiveCards(
        day: number,
        ivl: number,
        suspended: boolean,
        stability: number | undefined
    ) {
        if (ivl <= 0) {
            return
        }
        const allData = suspended ? suspended_active_cards_all_by_day : active_cards_all_by_day
        const youngData = suspended
            ? suspended_active_cards_young_by_day
            : active_cards_young_by_day
        const matureData = suspended
            ? suspended_active_cards_mature_by_day
            : active_cards_mature_by_day

        allData[day] = (allData[day] ?? 0) + 1
        if ((stability ?? ivl) >= stability_maturity_threshold) {
            matureData[day] = (matureData[day] ?? 0) + 1
        } else {
            youngData[day] = (youngData[day] ?? 0) + 1
        }
    }

    for (const revlog of revlogData) {
        const day = dayFromMs(revlog.id)
        const no_rollover_day = calendarDayFromMs(revlog.id)
        const hour = new Date(revlog.id).getHours()
        const ease = revlog.ease - 1
        const second = Math.round(revlog.time / 1000)
        const card = id_card_data[revlog.cid]

        function incrementAllEase(bin: keyof RevlogBuckets) {
            incrementEase(fatigue_ease[bin], day_review_count[day], ease)
            incrementEase(day_ease[bin], day, ease)
            incrementEase(day_ease_time[bin], day, ease, revlog.time / (60 * 1000))
            incrementEase(time_ease_seconds[bin], second, ease)
        }

        // A recorded rating counts as a review even when its answer time is zero.
        if (revlog.ease > 0) {
            card_times[revlog.cid] = (card_times[revlog.cid] ?? 0) + revlog.time
            if (revlog.type < 3) {
                day_review_hours[no_rollover_day] ??= Array(24).fill(0)
                day_review_hours[no_rollover_day][hour] =
                    day_review_hours[no_rollover_day][hour] + 1

                if (revlog.type == 0) {
                    learn_steps_per_card[revlog.cid] = (learn_steps_per_card[revlog.cid] ?? 0) + 1
                }
            }
            day_filtered_review_hours[no_rollover_day] ??= Array(24).fill(0)
            day_filtered_review_hours[no_rollover_day][hour] =
                day_filtered_review_hours[no_rollover_day][hour] + 1

            day_review_count[day] = (day_review_count[day] ?? -1) + 1
            incrementAllEase("all")
        }

        if (revlog.ease > 0) {
            incrementEase(interval_ease, revlog.lastIvl < 0 ? 0 : revlog.lastIvl, ease)
            if (revlog.lastIvl > 0) {
                incrementAllEase("not_learn")
                if (revlog.lastIvl >= 21) {
                    incrementAllEase("mature")
                    if (card) {
                        const last_sibling = last_siblings[card.nid]
                        if (last_sibling !== undefined && last_sibling.cid != revlog.cid) {
                            incrementEase(sibling_time_ease, day - last_sibling.day, ease)
                        }
                        last_siblings[card.nid] = {
                            cid: revlog.cid,
                            day,
                        }
                    }
                } else {
                    incrementAllEase("young")
                    if (card) {
                        last_siblings[card.nid] = undefined
                    }
                }
            } else {
                incrementAllEase("learn")
            }
        }
        if (isForget(revlog)) {
            introduced.delete(revlog.cid)
            forgotten.add(revlog.cid)
            last_forget[revlog.cid] = revlog.id
            if (revlog.lastIvl != 0) {
                day_forgotten[day] = (day_forgotten[day] ?? 0) + 1
                delete learn_steps_per_card[revlog.cid]
            }
        } else if (!introduced.has(revlog.cid) && revlog.ivl != 0) {
            introduced_day_count[day] = (introduced_day_count[day] ?? 0) + 1

            // Track the day this card was introduced
            card_introduction_day[revlog.cid] = day

            incrementEase(day_initial_reintroduced_ease, day, ease)
            if (reintroduced.has(revlog.cid)) {
                reintroduced_day_count[day] = (reintroduced_day_count[day] ?? 0) + 1
            } else {
                incrementEase(day_initial_ease, day, ease)
            }
            introduced.add(revlog.cid)
            reintroduced.add(revlog.cid)
            forgotten.delete(revlog.cid)
        }

        const hasRating = revlog.ease > 0
        const isResetEntry = !hasRating && revlog.factor === 0
        const isCrammingEntry = hasRating && revlog.type === 3 && revlog.factor === 0

        if (hasRating && !isCrammingEntry) {
            repetitionsByCard[revlog.cid] = (repetitionsByCard[revlog.cid] ?? 0) + 1
            const repetitionBucket = repetitionsByCard[revlog.cid]
            gradeByRepetitions[repetitionBucket] ??= [0, 0, 0, 0]
            gradeByRepetitions[repetitionBucket][revlog.ease - 1] += 1
            if (revlog.ease > 1) {
                gradeByRepetitionsSuccessOnly[repetitionBucket] ??= [0, 0, 0, 0]
                gradeByRepetitionsSuccessOnly[repetitionBucket][revlog.ease - 1] += 1
            }

            if (revlog.time > 0) {
                const seconds = revlog.time / 1000
                repetitionSamples.add(seconds, [repetitionBucket])
            }
        }

        if (isResetEntry) {
            forgetting_samples = forgetting_samples.filter((sample) => sample.cid !== revlog.cid)
            forgetting_samples_short = forgetting_samples_short.filter(
                (sample) => sample.cid !== revlog.cid
            )
            delete first_rating[revlog.cid]
            delete first_rating_day[revlog.cid]
            delete first_rating_time[revlog.cid]
            recorded_cards.delete(revlog.cid)
            short_term_recorded_cards.delete(revlog.cid)
        }

        if (hasRating && !isCrammingEntry) {
            if (first_rating[revlog.cid] === undefined && revlog.type == 0) {
                first_rating[revlog.cid] = revlog.ease
                first_rating_day[revlog.cid] = day
                first_rating_time[revlog.cid] = revlog.id
            }

            const first_time = first_rating_time[revlog.cid]
            if (
                first_time !== undefined &&
                first_rating[revlog.cid] &&
                first_rating[revlog.cid] !== 4 && // Exclude Easy rating for short-term curve
                !short_term_recorded_cards.has(revlog.cid)
            ) {
                const delta_ms = revlog.id - first_time
                if (delta_ms > 0 && delta_ms < day_ms) {
                    const delta_minutes = delta_ms / (60 * 1000)
                    if (delta_minutes > 0) {
                        forgetting_samples_short.push({
                            cid: revlog.cid,
                            firstRating: first_rating[revlog.cid]!,
                            delta: delta_minutes,
                            recall: revlog.ease > 1 ? 1 : 0,
                        })
                        short_term_recorded_cards.add(revlog.cid)
                    }
                }
            }

            const first_day = first_rating_day[revlog.cid]
            if (first_day !== undefined && !recorded_cards.has(revlog.cid)) {
                const delta_t = day - first_day
                if (delta_t > 0) {
                    forgetting_samples.push({
                        cid: revlog.cid,
                        firstRating: first_rating[revlog.cid]!,
                        delta: delta_t,
                        recall: revlog.ease > 1 ? 1 : 0,
                    })
                    recorded_cards.add(revlog.cid)
                }
            }
        }
    }

    const first_day = revlogData.length ? dayFromMs(revlogData.id(0)) : end
    for (let i = first_day; i < end; i++) {
        burden[i] = 0
        intervals[i] = []
    }

    const revlog = revlogData.cursor()
    for (revlog.index = revlogData.length - 1; revlog.index >= 0; revlog.index--) {
        const day = dayFromMs(revlog.id)
        const card = id_card_data[revlog.cid]

        const next_review = last_cids[revlog.cid]
        // If the card is still learning, use the card data
        let ivl =
            next_review !== undefined ? revlog.ivl : card.type != 3 && card.type != 1 ? card.ivl : 0
        // Cramming does not change the card's scheduled interval.
        if (isCram(revlog)) {
            continue
        }
        // Ignore "forgets"
        if (
            (revlog.factor == 0 && revlog.type == 4) ||
            (next_review === undefined && card.queue == 0)
        ) {
            last_cids[revlog.cid] = revlog.id
            next_review_was_reset[revlog.cid] = !!isForget(revlog)
            continue
        }
        ivl = ivl > 0 ? ivl : 0

        const isCurrentSuspendedSegment = next_review === undefined && card.queue == -1
        const activeIvl = isCurrentSuspendedSegment ? (card.ivl > 0 ? card.ivl : 0) : ivl
        const stability = stability_after_review[revlog.index]
        const segmentStability = Number.isFinite(stability) ? stability : undefined

        // If the card is suspended
        if (isCurrentSuspendedSegment) {
            ivl = -1
        }

        const is_load = !next_review_was_reset[revlog.cid] && ivl != -1
        let to = next_review !== undefined ? dayFromMs(next_review) : end + 1

        for (let intervalDay = day; intervalDay < to; intervalDay++) {
            intervals[intervalDay] = intervals[intervalDay] ?? []
            // -1 suspended
            // -2 learn (0 still contains learn as well)
            intervals[intervalDay][ivl] = (intervals[intervalDay][ivl] ?? 0) + 1
            incrementActiveCards(
                intervalDay,
                activeIvl,
                isCurrentSuspendedSegment,
                segmentStability
            )

            if (ivl == 0 && (revlog.type == 0 || (next_review === undefined && card.type == 1))) {
                intervals[intervalDay][-2] = (intervals[intervalDay][-2] ?? 0) + 1
            }

            if (is_load) {
                burden[intervalDay] = (burden[intervalDay] ?? 0) + (ivl > 0 ? 1 / ivl : 1)
            }
        }

        last_cids[revlog.cid] = revlog.id
        next_review_was_reset[revlog.cid] = false
    }

    // Calculate current load by introduction day
    for (const card of cardData) {
        const intro_day = card_introduction_day[card.id]
        if (intro_day !== undefined && card.ivl > 0 && card.queue !== -1) {
            const load = 1 / card.ivl
            introduced_load_by_day[intro_day] = (introduced_load_by_day[intro_day] ?? 0) + load
        }
    }

    for (const card_time of Object.values(card_times)) {
        const key = Math.floor(card_time / 1000)
        revlog_times[key] = (revlog_times[key] ?? 0) + 1
    }

    const remaining_forgotten = forgotten.size
    const longTermForgettingCurveCardIds = new Set<number>(
        forgetting_samples.map((sample) => sample.cid)
    )
    const forgetting_curve_long_term_model = forgettingCurveModelsForCards(
        longTermForgettingCurveCardIds,
        id_card_data,
        presets
    )

    const forgettingCurveCardIds = new Set<number>(
        [...forgetting_samples, ...forgetting_samples_short].map((sample) => sample.cid)
    )
    const forgetting_curve_short_term_model = forgettingCurveModelsForCards(
        forgettingCurveCardIds,
        id_card_data,
        presets
    )
    const decayValues = Array.from(forgettingCurveCardIds)
        .map((cid) => id_card_data[cid])
        .filter((card): card is CardData => card !== undefined)
        .map((card) => getCardDecay(card))
    const forgetting_curve_decay =
        decayValues.length > 0 ? averageDecay(decayValues) : FSRS5_DEFAULT_DECAY
    const retrievabilityTimeStats = bucketTimeStats(fsrsReplayStats.timeByRetrievabilitySamples)
    const stabilityTimeStats = bucketTimeStats(fsrsReplayStats.timeByStabilitySamples)
    const [timeByRepetitionSamples] = repetitionSamples.finish()
    const repetitionTimeStats = bucketTimeStats(timeByRepetitionSamples)

    console.timeEnd("revlog stats")

    return {
        day_initial_ease,
        day_initial_reintroduced_ease,
        day_ease,
        day_ease_time,
        fatigue_ease,
        time_ease_seconds,
        sibling_time_ease,
        interval_ease,
        revlog_times,
        introduced_day_count,
        introduced_load_by_day,
        reintroduced_day_count,
        active_cards_all_by_day,
        active_cards_young_by_day,
        active_cards_mature_by_day,
        suspended_active_cards_all_by_day,
        suspended_active_cards_young_by_day,
        suspended_active_cards_mature_by_day,
        burden,
        day_forgotten,
        remaining_forgotten,
        intervals,
        day_review_hours,
        day_filtered_review_hours,
        learn_steps_per_card: Object.values(learn_steps_per_card),
        last_forget,
        forgetting_samples,
        forgetting_samples_short,
        forgetting_curve_decay,
        forgetting_curve_long_term_model,
        forgetting_curve_short_term_model,
        time_by_retrievability_mean: retrievabilityTimeStats.meanByBucket,
        time_by_retrievability_median: retrievabilityTimeStats.medianByBucket,
        time_by_stability_mean: stabilityTimeStats.meanByBucket,
        time_by_stability_median: stabilityTimeStats.medianByBucket,
        time_by_repetition_samples: timeByRepetitionSamples,
        time_by_repetition_mean: repetitionTimeStats.meanByBucket,
        time_by_repetition_median: repetitionTimeStats.medianByBucket,
        grade_by_retrievability: fsrsReplayStats.gradeByRetrievability,
        grade_by_retrievability_exclude_same_day:
            fsrsReplayStats.gradeByRetrievabilityExcludeSameDay,
        grade_by_retrievability_success_only: fsrsReplayStats.gradeByRetrievabilitySuccessOnly,
        grade_by_retrievability_success_only_exclude_same_day:
            fsrsReplayStats.gradeByRetrievabilitySuccessOnlyExcludeSameDay,
        grade_by_stability: fsrsReplayStats.gradeByStability,
        grade_by_stability_success_only: fsrsReplayStats.gradeByStabilitySuccessOnly,
        grade_by_repetitions: gradeByRepetitions,
        grade_by_repetitions_success_only: gradeByRepetitionsSuccessOnly,
        grade_by_difficulty: fsrsReplayStats.gradeByDifficulty,
        grade_by_difficulty_success_only: fsrsReplayStats.gradeByDifficultySuccessOnly,
    }
}

export const EASE_COLOURS = ["#a50026", "#fdbe70", "#b6e076", "#006837"].reverse()
export const EASE_LABELS = [i18n("again"), i18n("hard"), i18n("good"), i18n("easy")].reverse()

export function retentionStats(data: BarDatum) {
    return [_.sum(data.values) ? formatRetention(1 - data.values[3]) : "No data"]
}

export function formatRetention(value: number) {
    return i18n("percent-correct", { percentage: (100 * value).toFixed(2) })
}

export function easeBarChart(
    eases: number[][],
    offset = today,
    normalise = false,
    columnLabeler: BarChart["columnLabeler"] = undefined
): BarChart {
    return {
        row_colours: EASE_COLOURS,
        row_labels: EASE_LABELS,
        data: Array.from(eases).map((data, label) => {
            let values = [...(data ?? [0, 0, 0, 0])].reverse()
            const sum = _.sum(values)
            values = normalise && sum > 0 ? values.map((a) => a / sum) : values
            return {
                values,
                label: (label - offset).toString(),
            }
        }),
        tick_spacing: 5,
        reverse_legend: true,
        columnLabeler,
        extraStats: normalise ? retentionStats : totalCalc,
        hidden_rows: new Set(),
        normalise: normalise,
    }
}

export { lastForgetByCard } from "./revlogMetadata"
