import _ from "lodash"
import {
    type Card,
    checkParameters,
    createEmptyCard,
    dateDiffInDays,
    type FSRS,
    fsrs as Fsrs,
    FSRS5_DEFAULT_DECAY,
    type FSRSState,
    generatorParameters,
} from "ts-fsrs"
import type { BarChart, BarDatum } from "./bar"
import { totalCalc } from "./barHelpers"
import type { DeckConfig } from "./config"
import { averageDecay, type ForgettingSample } from "./forgettingCurveData"
import { selectTsFsrsParams } from "./fsrsParams"
import { i18n } from "./i18n"
import { type CardData, getCardDecay, type Revlog } from "./search"

const rollover = SSEother.rollover ?? 0
export const rollover_ms = rollover * 60 * 60 * 1000
export const day_ms = 1000 * 60 * 60 * 24
const half_day_ms = day_ms / 2
const date_only_re = /^\d{4}-\d{2}-\d{2}$/

const timezone_offset_mins = new Date().getTimezoneOffset()
const timezone_offset_ms = timezone_offset_mins * 60 * 1000
export function dayFromMs(ms: number) {
    return Math.floor((ms - rollover_ms - timezone_offset_ms) / day_ms)
}

export function dayToMs(day: number) {
    return day * day_ms + rollover_ms + timezone_offset_ms
}

export function dayToDateString(day: number) {
    return new Date(dayToMs(day) + half_day_ms).toISOString().slice(0, 10)
}

export function dayFromDateString(date: string) {
    if (!date_only_re.test(date)) {
        return
    }
    const ms = Date.parse(`${date}T12:00:00.000Z`)
    if (!Number.isFinite(ms)) {
        return
    }
    return dayFromMs(ms)
}

export const today = dayFromMs(Date.now())
export const no_rollover_today = Math.floor(Date.now() / day_ms)
const stability_maturity_threshold = 21

let deckFsrs: Record<number, FSRS> = {}

function getFsrs(config: DeckConfig) {
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

function stabilityAfterReviewsByRevlog(
    revlogData: Revlog[],
    id_card_data: Record<number, CardData>
) {
    const stabilityByRevlog = new Map<Revlog, number>()
    const deckConfigs = SSEother.deck_configs
    const deckConfigIds = SSEother.deck_config_ids
    if (!deckConfigs || !deckConfigIds) {
        return stabilityByRevlog
    }

    const fsrsCards: Record<number, Card> = {}

    for (const revlog of [...revlogData].sort((a, b) => a.id - b.id)) {
        const cardData = id_card_data[revlog.cid]
        if (!cardData) {
            continue
        }
        const deckConfigId = deckConfigIds[cardData.odid || cardData.did]
        if (deckConfigId === undefined) {
            continue
        }
        const config = deckConfigs[deckConfigId]
        if (!config) {
            continue
        }

        const fsrs = getFsrs(config)
        const now = new Date(revlog.id)
        const hasPreviousReview = !!fsrsCards[revlog.cid]
        let card = fsrsCards[revlog.cid] ?? createEmptyCard(new Date(revlog.cid))

        if (revlog.factor == 0 && revlog.type == 4 && hasPreviousReview) {
            card = fsrs.forget(card, now).card
            fsrsCards[revlog.cid] = card
        }

        if (revlog.ease == 0) {
            continue
        }
        if (revlog.type == 3 && revlog.factor == 0) {
            continue
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
        }

        const newState = fsrs.next_state(memoryState, elapsed, revlog.ease)
        card.last_review = now
        card.stability = newState.stability
        card.difficulty = newState.difficulty
        fsrsCards[revlog.cid] = card
        stabilityByRevlog.set(revlog, card.stability)
    }

    return stabilityByRevlog
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

export function calculateRevlogStats(
    revlogData: Revlog[],
    cardData: CardData[],
    end: number = today
) {
    console.time("revlog stats")
    let id_card_data = IDify(cardData)
    const stability_after_review = stabilityAfterReviewsByRevlog(revlogData, id_card_data)

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
    let last_cids: Record<number, Revlog> = {}

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

    function incrementEase(ease_array: number[][], day: number, ease: number, amount = 1) {
        // Doesn't check for negative ease (manual reschedule)
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
        const no_rollover_day = Math.floor(revlog.id / day_ms)
        const hour = Math.floor(((revlog.id - timezone_offset_ms) % day_ms) / (60 * 60 * 1000))
        const ease = revlog.ease - 1
        const second = Math.round(revlog.time / 1000)
        const card = id_card_data[revlog.cid]

        function incrementAllEase(bin: keyof RevlogBuckets) {
            incrementEase(fatigue_ease[bin], day_review_count[day], ease)
            incrementEase(day_ease[bin], day, ease)
            incrementEase(day_ease_time[bin], day, ease, revlog.time / (60 * 1000))
            incrementEase(time_ease_seconds[bin], second, ease)
        }

        card_times[revlog.cid] = (card_times[revlog.cid] ?? 0) + revlog.time

        // Check for reschedules
        if (revlog.time != 0) {
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
        if (revlog.factor == 0 && revlog.type == 4) {
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

    // "reduceRight" Used here to iterate backwards, never returns true
    revlogData.reduceRight((_p, revlog) => {
        const day = dayFromMs(revlog.id)
        const card = id_card_data[revlog.cid]

        const next_review = last_cids[revlog.cid]
        // If the card is still learning, use the card data
        let ivl = next_review ? revlog.ivl : card.type != 3 && card.type != 1 ? card.ivl : 0
        // Ignore "forgets"
        if ((revlog.factor == 0 && revlog.type == 4) || (!next_review && card.queue == 0)) {
            last_cids[revlog.cid] = revlog
            return undefined
        }
        ivl = ivl > 0 ? ivl : 0

        const isCurrentSuspendedSegment = !next_review && card.queue == -1
        const activeIvl = isCurrentSuspendedSegment ? (card.ivl > 0 ? card.ivl : 0) : ivl
        const segmentStability = stability_after_review.get(revlog)

        // If the card is suspended
        if (isCurrentSuspendedSegment) {
            ivl = -1
        }

        let to = next_review ? dayFromMs(next_review.id) : end + 1

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

            if (ivl == 0 && (revlog.type == 0 || (!next_review && card.type == 1))) {
                intervals[intervalDay][-2] = (intervals[intervalDay][-2] ?? 0) + 1
            }
        }

        last_cids[revlog.cid] = revlog

        return undefined
    }, undefined)

    const burden = Array.from(intervals).map((v) => {
        if (!v) {
            return 0
        } else {
            return _.sum(v.map((val, ivl) => val / (ivl || 1))) ?? 0
        }
    })

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
    const forgettingCurveCardIds = new Set<number>(
        [...forgetting_samples, ...forgetting_samples_short].map((sample) => sample.cid)
    )
    const decayValues = Array.from(forgettingCurveCardIds)
        .map((cid) => id_card_data[cid])
        .filter((card): card is CardData => card !== undefined)
        .map((card) => getCardDecay(card))
    const forgetting_curve_decay =
        decayValues.length > 0 ? averageDecay(decayValues) : FSRS5_DEFAULT_DECAY

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
    normalize = false,
    columnLabeler: BarChart["columnLabeler"] = undefined
): BarChart {
    return {
        row_colours: EASE_COLOURS,
        row_labels: EASE_LABELS,
        data: Array.from(eases).map((data, label) => {
            const sum = _.sum(data)
            let values = [...(data ?? [0, 0, 0, 0])].reverse()
            values = normalize ? values.map((a) => a / sum) : values
            return {
                values,
                label: (label - offset).toString(),
            }
        }),
        tick_spacing: 5,
        reverse_legend: true,
        columnLabeler,
        extraStats: normalize ? retentionStats : totalCalc,
    }
}
