import { FSRS5_DEFAULT_DECAY } from "ts-fsrs"
import { forgettingCurve as forgetting_curve } from "ts-fsrs/models/fsrs-6"
import { curve, FSRS7_DEFAULT_WEIGHTS } from "ts-fsrs/models/fsrs-7"
import { calculateCardDataPies } from "../src/ts/CardDataPies"
import { dueDayOffset } from "../src/ts/cardDue"
import type { DeckConfig } from "../src/ts/config"
import { day_ms, dayFromMs, today } from "../src/ts/revlogGraphs"
import type { CardData } from "../src/ts/search"

const weights6 = [
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
    1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621, 0.1, 0.5,
]

const weights7 = [...FSRS7_DEFAULT_WEIGHTS]
const state7 = { stability: 12, stabilityFast: 3, difficulty: 8 }

function deckConfig(params: Partial<DeckConfig>): DeckConfig {
    return {
        id: 1,
        fsrsVersion: 0,
        fsrsParams7: [],
        fsrsParams6: [],
        fsrsParams5: [],
        fsrsParams4: [],
        fsrsWeights: [],
        ...params,
    } as DeckConfig
}

function reviewCard(params: Partial<CardData> = {}): CardData {
    return {
        id: 1,
        nid: 1,
        did: 10,
        ord: 0,
        mod: 0,
        usn: 0,
        type: 2,
        queue: 2,
        due: 7,
        ivl: 7,
        factor: 0,
        reps: 1,
        lapses: 0,
        left: 0,
        odue: 0,
        odid: 0,
        flags: 0,
        data: JSON.stringify({ s: 12, s_int: 12, s_fast: 3, d: 8, decay: 0.1 }),
        ...params,
    }
}

beforeEach(() => {
    SSEother.days_elapsed = 0
})

test("future due retrievability totals include only eligible review cards", () => {
    const stats = calculateCardDataPies(
        [
            reviewCard(),
            reviewCard({ id: 2, type: 1 }),
            reviewCard({ id: 3, type: 3 }),
            reviewCard({ id: 4, queue: -1 }),
            reviewCard({ id: 5, data: "{}" }),
            reviewCard({ id: 6, due: 8 }),
        ],
        false,
        false,
        { 1: deckConfig({ fsrsParams7: weights7 }) },
        { 10: 1 }
    )
    expect(stats.target_R_day_totals[7]).toBe(1)
    expect(stats.target_R_day_totals[8]).toBe(1)
    expect(stats.target_R_days[7]).toBeCloseTo(curve(weights7, 7, state7).retrievability, 6)
})

test("future due retention uses selected FSRS7 deck model", () => {
    const stats = calculateCardDataPies(
        [reviewCard()],
        false,
        false,
        {
            1: deckConfig({
                id: 1,
                fsrsVersion: 0,
                fsrsParams7: weights7,
                fsrsParams6: weights6,
            }),
        },
        { 10: 1 }
    )

    const expected = curve(weights7, 7, state7).retrievability
    const decayOnly = forgetting_curve(0.1, 7, 12)

    expect(stats.target_R_days[7]).toBeCloseTo(expected, 6)
    expect(stats.target_R_days[7]).not.toBeCloseTo(decayOnly, 6)
})

test("future due retention follows selected FSRS version", () => {
    const stats = calculateCardDataPies(
        [reviewCard()],
        false,
        false,
        {
            1: deckConfig({
                id: 1,
                fsrsVersion: 1,
                fsrsParams7: weights7,
                fsrsParams6: weights6,
            }),
        },
        { 10: 1 }
    )

    const expected = forgetting_curve(weights6, 7, 12)
    const fsrs7Value = curve(weights7, 7, state7).retrievability

    expect(stats.target_R_days[7]).toBeCloseTo(expected, 6)
    expect(stats.target_R_days[7]).not.toBeCloseTo(fsrs7Value, 6)
})

test("future due retention keeps decay-only card path when deck config is unavailable", () => {
    const stats = calculateCardDataPies(
        [reviewCard({ data: JSON.stringify({ s: 12 }) })],
        false,
        false
    )

    expect(stats.target_R_days[7]).toBeCloseTo(forgetting_curve(FSRS5_DEFAULT_DECAY, 7, 12), 6)
})

test("future due retention uses internal stability when stored S90 differs", () => {
    const stats = calculateCardDataPies(
        [reviewCard({ data: JSON.stringify({ s: 4, s_int: 12, s_fast: 3, d: 8 }) })],
        false,
        false,
        {
            1: deckConfig({
                id: 1,
                fsrsVersion: 0,
                fsrsParams7: weights7,
            }),
        },
        { 10: 1 }
    )

    expect(stats.target_R_days[7]).toBeCloseTo(curve(weights7, 7, state7).retrievability, 6)
    expect(stats.target_R_days[7]).not.toBeCloseTo(
        curve(weights7, 7, { ...state7, stability: 4 }).retrievability,
        6
    )
})

test("future due retention skips incomplete FSRS-7 state", () => {
    const stats = calculateCardDataPies(
        [reviewCard({ data: JSON.stringify({ s: 12, s_int: 12, d: 8 }) })],
        false,
        false,
        { 1: deckConfig({ fsrsParams7: weights7 }) },
        { 10: 1 }
    )
    expect(stats.target_R_days).toEqual([])
    expect(stats.target_R_day_totals).toEqual([])
})

test("due dates use a filtered card's original due date", () => {
    expect(dueDayOffset({ due: 10, odue: 102 } as any, 100)).toBe(2)
    expect(dueDayOffset({ due: 102, odue: 0 } as any, 100)).toBe(2)
})

test("Unix due dates are seconds and map to a whole collection day", () => {
    const due = Math.floor((Date.now() + 2 * day_ms) / 1000)
    expect(dueDayOffset({ due, odue: 0 } as any, 100)).toBe(dayFromMs(due * 1000) - today)
    expect(dueDayOffset({ due, odue: 0 } as any, 100)).toBe(2)
})
