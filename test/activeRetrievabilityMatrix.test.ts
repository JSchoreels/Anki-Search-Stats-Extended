import { FSRS7_DEFAULT_WEIGHTS } from "ts-fsrs/models/fsrs-7"
import {
    activeRetrievabilityCellSearch,
    activeRetrievabilityThresholds,
    buildActiveRetrievabilityMatrix,
    calculateActiveRetrievabilityHistory,
    DEFAULT_ACTIVE_RETRIEVABILITY_THRESHOLDS as defaults,
    validActiveRetrievabilityThresholds,
} from "../src/ts/activeRetrievabilityMatrix"
import { ankiDaySnapshotMs } from "../src/ts/ankiDay"
import type { CardData, Revlog } from "../src/ts/cardData"
import type { ResolvedFsrsPreset } from "../src/ts/config"
import { elapsedFsrsDays, getFsrs } from "../src/ts/fsrsModel"
import { packRevlogs, RevlogHistory } from "../src/ts/packedRevlogs"
import { dayFromMs, rollover_ms } from "../src/ts/revlogGraphs"
import { runStatsTaskLocally } from "../src/ts/statsTasks"
const preset = {
    params: [...FSRS7_DEFAULT_WEIGHTS],
    fsrsVersion: "seven",
    desiredRetention: 0.9,
    historicalRetention: 0.9,
    ignoreRevlogsBeforeDate: "",
} as ResolvedFsrsPreset
const day = 86400000
const start = new Date(2025, 0, 2, 12).getTime()
const card = (id: number, extra: Partial<CardData> = {}) =>
    ({ id, type: 2, queue: 2, reps: 5, ivl: 20, ...extra }) as CardData
const review = (cid: number, offset = 0, extra: Partial<Revlog> = {}) =>
    ({
        cid,
        id: start + offset,
        ease: 3,
        type: 0,
        ivl: -60,
        lastIvl: 0,
        factor: 2500,
        time: 1000,
        ...extra,
    }) as Revlog

test("thresholds validate persisted settings and keep both middle endpoints", () => {
    expect(activeRetrievabilityThresholds(null)).toEqual(defaults)
    for (const value of [
        { ...defaults, daysLower: 1.5 },
        { ...defaults, daysUpper: 30 },
        { ...defaults, rLower: 0 },
        { ...defaults, rUpper: 101 },
        { ...defaults, rUpper: 80 },
    ]) {
        expect(validActiveRetrievabilityThresholds(value)).toBe(false)
        expect(activeRetrievabilityThresholds(value)).toEqual(defaults)
    }
    const cards = [29, 30, 180, 181].flatMap((days, row) =>
        [79, 80, 90, 91].map((averageR, column) => ({
            id: row * 4 + column + 1,
            days,
            averageR,
            workload: 0.05,
        }))
    )
    const matrix = buildActiveRetrievabilityMatrix(cards, defaults)
    expect(matrix.cells.map((row) => row.map((cell) => cell.count))).toEqual([
        [1, 2, 1],
        [2, 4, 2],
        [1, 2, 1],
    ])
    expect(matrix.total.count).toBe(16)
    expect(matrix.total.workload).toBeCloseTo(0.8)
    expect(matrix.rowTotals.reduce((v, c) => v + c.workload, 0)).toBeCloseTo(0.8)
    expect(matrix.columnTotals.reduce((v, c) => v + c.workload, 0)).toBeCloseTo(0.8)
    expect(matrix.diagonal.count).toBe(6)
    expect(activeRetrievabilityCellSearch(matrix.cells[0][0])).toBe("cid:1")
    expect(activeRetrievabilityCellSearch(matrix.rowTotals[0])).toBe("cid:1,2,3,4")
    expect(new Set(matrix.total.ids)).toEqual(new Set(cards.map((c) => c.id)))
    expect(activeRetrievabilityCellSearch({ count: 0, workload: 0, ids: [] })).toBe("cid:0")
    expect(
        buildActiveRetrievabilityMatrix(cards, {
            ...defaults,
            daysLower: 1,
            daysUpper: 2,
        }).cells[2].reduce((v, c) => v + c.count, 0)
    ).toBe(16)
})

test("daily snapshots average full fast/slow states, use now today, and stored intervals for workload", () => {
    const now = start + 2 * day + 3600000
    const result = calculateActiveRetrievabilityHistory(
        [review(1)],
        [card(1, { ivl: 40 }), card(1)],
        { 1: preset },
        now
    )
    const model = getFsrs(preset)
    const state = model.nextState(null, 0, 3)
    let expected = 0
    for (let d = dayFromMs(start); d <= dayFromMs(now); d++) {
        const ms = ankiDaySnapshotMs(d, rollover_ms / 3600000, now)
        expected += model.retrievability(
            state,
            elapsedFsrsDays(model, new Date(start), new Date(ms), rollover_ms)
        )
    }
    expect(result.cards[0]).toMatchObject({ id: 1, days: 3, workload: 0.025 })
    expect(result.cards[0].averageR).toBeCloseTo((100 * expected) / 3, 10)
    expect(result.cards).toHaveLength(1)
    const sameDay = calculateActiveRetrievabilityHistory(
        [review(1)],
        [card(1, { ivl: 0 })],
        { 1: preset },
        start
    )
    expect(sameDay.cards[0]).toMatchObject({ days: 1, workload: 1 })
    expect(sameDay.cards[0].averageR).toBe(100 * model.retrievability(state, 0))
    const later = calculateActiveRetrievabilityHistory(
        [review(1)],
        [card(1)],
        { 1: preset },
        now + 3600000
    )
    expect(later.cards[0].averageR).toBeLessThan(result.cards[0].averageR)
})

test("coverage excludes new/inactive and reports absent initial learning, presets and history", () => {
    const result = calculateActiveRetrievabilityHistory(
        [review(1), review(2, 0, { type: 1, ivl: 100 }), review(3)],
        [
            card(1),
            card(2),
            card(3),
            card(4),
            card(5, { type: 0 }),
            card(6, { queue: -1 }),
            card(7, { queue: -2 }),
            card(8, { reps: 0 }),
        ],
        { 1: preset, 2: preset, 4: preset },
        start + day
    )
    expect(result.cards.map((c) => c.id)).toEqual([1])
    expect(result.excluded).toBe(4)
    expect(result.incomplete).toBe(3)
    expect(
        calculateActiveRetrievabilityHistory(
            [review(1), review(1, 8 * day, { type: 1, ivl: 100 })],
            [card(1)],
            { 1: { ...preset, ignoreRevlogsBeforeDate: "2025-01-05" } },
            start + 9 * day
        ).incomplete
    ).toBe(1)
})

test("cram/manual/future entries cannot change averages; unordered packed replay is identical", () => {
    const now = start + day
    const baseline = calculateActiveRetrievabilityHistory(
        [review(1)],
        [card(1)],
        { 1: preset },
        now
    )
    const reviews = [
        review(1),
        review(1, 1, { type: 3, factor: 0, ease: 4 }),
        review(1, 2, { type: 4, ease: 0 }),
        review(1, 10 * day, { type: 0, ease: 4 }),
    ]
    expect(
        calculateActiveRetrievabilityHistory(reviews.reverse(), [card(1)], { 1: preset }, now)
    ).toEqual(baseline)
    expect(
        runStatsTaskLocally("activeRetrievability", [
            new RevlogHistory(packRevlogs(reviews)),
            [card(1)],
            { 1: preset },
            now,
        ])
    ).toEqual(baseline)
})

test("reset gaps and incomplete later cycles are unavailable; same-day complete relearning preserves introduction", () => {
    const reset = review(1, day, { type: 4, ease: 0, factor: 0 })
    expect(
        calculateActiveRetrievabilityHistory(
            [review(1), reset],
            [card(1)],
            { 1: preset },
            start + 2 * day
        ).incomplete
    ).toBe(1)
    expect(
        calculateActiveRetrievabilityHistory(
            [review(1), reset, review(1, 2 * day)],
            [card(1)],
            { 1: preset },
            start + 3 * day
        ).incomplete
    ).toBe(1)
    expect(
        calculateActiveRetrievabilityHistory(
            [review(1), reset, review(1, day + 1, { type: 1, ivl: 10 })],
            [card(1)],
            { 1: preset },
            start + 2 * day
        ).incomplete
    ).toBe(1)
    const complete = calculateActiveRetrievabilityHistory(
        [review(1), reset, review(1, day + 1)],
        [card(1)],
        { 1: preset },
        start + 2 * day
    )
    expect(complete.cards[0].days).toBe(3)
    expect(complete.incomplete).toBe(0)
})

test("unsupported resolved presets count as incomplete instead of failing the matrix", () => {
    const result = calculateActiveRetrievabilityHistory(
        [review(1), review(2)],
        [card(1), card(2)],
        { 1: preset, 2: { ...preset, params: [1, 2, 3] } },
        start + day
    )
    expect(result.cards.map((c) => c.id)).toEqual([1])
    expect(result.incomplete).toBe(1)
})

test("daily sample uses the final review state and includes elapsed days without reviews", () => {
    const secondAt = start + 3600000
    const thirdAt = start + 2 * day
    const now = thirdAt + 7200000
    const model = getFsrs(preset)
    const initial = model.nextState(null, 0, 3)
    const second = model.nextState(
        initial,
        elapsedFsrsDays(model, new Date(start), new Date(secondAt), rollover_ms),
        4
    )
    const third = model.nextState(
        second,
        elapsedFsrsDays(model, new Date(secondAt), new Date(thirdAt), rollover_ms),
        1
    )
    const expected =
        ([0, 1, 2]
            .map((offset) => {
                const at = ankiDaySnapshotMs(dayFromMs(start) + offset, rollover_ms / 3600000, now)
                return model.retrievability(
                    offset === 2 ? third : second,
                    elapsedFsrsDays(
                        model,
                        new Date(offset === 2 ? thirdAt : secondAt),
                        new Date(at),
                        rollover_ms
                    )
                )
            })
            .reduce((a, b) => a + b, 0) *
            100) /
        3
    const result = calculateActiveRetrievabilityHistory(
        [
            review(1),
            review(1, 3600000, { ease: 4 }),
            review(1, 2 * day, { type: 1, ivl: 3, ease: 1 }),
        ],
        [card(1)],
        { 1: preset },
        now
    )
    expect(result.cards[0].averageR).toBeCloseTo(expected, 10)
})
