import { FSRS7Algorithm, FSRS7_DEFAULT_WEIGHTS, FSRS7_MODEL_BOUNDS } from "ts-fsrs/models/fsrs-7"
import { getMemorisedDays } from "../src/ts/MemorisedBar"
import type { CardData, Revlog } from "../src/ts/cardData"
import type { DeckConfig } from "../src/ts/config"
import { calculateEaseFactors } from "../src/ts/easeFactor"
import { calculateRevlogStats, dayFromMs } from "../src/ts/revlogGraphs"
import { create_card_sr_dataset } from "../src/ts/srHeatmap"

const weights = [...FSRS7_DEFAULT_WEIGHTS]
const config = { id: 1, fsrsVersion: 0, fsrsParams7: weights } as DeckConfig
const core = new FSRS7Algorithm(weights, FSRS7_MODEL_BOUNDS)

const card = {
    id: 1,
    nid: 1,
    did: 1,
    odid: 0,
    odue: 0,
    type: 2,
    queue: 2,
    due: 100,
    ivl: 10,
    reps: 3,
    lapses: 1,
    data: JSON.stringify({ s: 4, s_int: 10, s_fast: 2, d: 8, dr: 0.9 }),
} as CardData

beforeEach(() => {
    SSEother.deck_configs = { 1: config }
    SSEother.deck_config_ids = { 1: 1 }
})

afterEach(() => {
    delete SSEother.deck_configs
    delete SSEother.deck_config_ids
})

function review(id: number, ease: Revlog["ease"], time: number, type = 1): Revlog {
    return { id, cid: 1, ease, time, type, factor: type === 4 ? 0 : 200, ivl: 1, lastIvl: 1 }
}

function population(reviews: Revlog[]) {
    // Calibration's existing outlier filter requires a group of at least 20 cards.
    const cards = Array.from({ length: 20 }, (_, i) => ({ ...card, id: i + 1, nid: i + 1 }))
    const history = reviews.flatMap((review) =>
        cards.map((card) => ({
            ...review,
            cid: card.id,
            id: review.id + card.id - 1,
        }))
    )
    return { cards, history }
}

test("Memorised and rating replay preserve the fast trace after a same-day review", async () => {
    const start = new Date(2026, 8, 1, 12).getTime()
    const reviews = [
        review(start, 1, 1000, 0),
        review(start + 600000, 3, 2000),
        review(start + 87000000, 3, 5000),
    ]
    const initial = core.next_state(null, 0, 1)
    const second = core.next_state(initial, 10 / 1440, 3)
    const expected = core.curve(1, second).retrievability
    const { cards, history } = population(reviews)
    const memorised = await getMemorisedDays(history, cards, { 1: config }, { 1: 1 })
    const stats = calculateRevlogStats(history, cards)

    expect(memorised.fsrs_calibration_predictions_by_revlog_id[reviews[2].id]).toBeCloseTo(
        expected,
        9
    )
    expect(memorised.time_by_retrievability_mean[Math.floor(expected * 100)]).toBe(5)
    expect(stats.grade_by_retrievability[Math.floor(expected * 100)]).toEqual([0, 0, 20, 0])
    expect(memorised.day_means[dayFromMs(start)]).toBeCloseTo(core.next_interval(second, 0.9), 9)
})

test("a manual reset rebuilds both traces from the next rated review", async () => {
    const start = new Date(2026, 8, 1, 12).getTime()
    const reviews = [
        review(start, 1, 1000, 0),
        review(start + 600000, 3, 2000),
        review(start + 86400000, 0, 0, 4),
        review(start + 86401000, 4, 3000, 0),
        review(start + 172801000, 3, 5000),
    ]
    const { cards, history } = population(reviews)
    const memorised = await getMemorisedDays(history, cards, { 1: config }, { 1: 1 })
    const expected = core.curve(1, core.next_state(null, 0, 4)).retrievability
    expect(memorised.fsrs_calibration_predictions_by_revlog_id[reviews[4].id]).toBeCloseTo(
        expected,
        9
    )
    expect(memorised.fsrs_calibration_predictions_by_revlog_id[reviews[3].id]).toBeUndefined()
})

test("S90 deduplication keeps states in the same slow-stability bucket with different difficulty", async () => {
    const start = new Date(2026, 8, 1, 12).getTime()
    const reviews = [review(start, 1, 1000, 0), review(start + 1, 3, 2000)]
    const resolve = jest.fn(async (items) =>
        items.map((item: any) => core.next_interval(item, 0.9))
    )
    await getMemorisedDays(reviews, [card], { 1: config }, { 1: 1 }, [], 2, 2, {}, resolve)
    const items = resolve.mock.calls[0][0]
    expect(items).toHaveLength(2)
    expect(items[0].stabilityFast).toBeGreaterThan(0)
    expect(items[0].difficulty).not.toBe(items[1].difficulty)
})

test("current-card heatmap and ease gain use the stored complete state", () => {
    const state = { stability: 10, stabilityFast: 2, difficulty: 8 }
    const dataset = create_card_sr_dataset([card], { 1: core.curve(10, state).retrievability })!
    expect(dataset.card_sr_data[0].s).toBe(4)
    expect(dataset.card_sr_data[0].r).toBeCloseTo(core.curve(10, state).retrievability, 10)
    const interval = core.next_interval(state, 0.9)
    expect(calculateEaseFactors([card], { 1: config }, { 1: 1 })[0]).toBeCloseTo(
        core.next_state(state, interval, 3).stability / state.stability,
        10
    )
    const incomplete = { ...card, data: JSON.stringify({ s: 4, s_int: 10, d: 8, dr: 0.9 }) }
    expect(create_card_sr_dataset([incomplete], {})).toBeNull()
    expect(calculateEaseFactors([incomplete], { 1: config }, { 1: 1 })).toEqual([])
})
