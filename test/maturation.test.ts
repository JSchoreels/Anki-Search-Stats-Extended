import { FSRS7_DEFAULT_WEIGHTS } from "ts-fsrs/models/fsrs-7"
import type { CardData, Revlog } from "../src/ts/cardData"
import type { ResolvedFsrsPreset } from "../src/ts/config"
import { getFsrs, intervalAtRetrievability } from "../src/ts/fsrsModel"
import {
    buildMaturationSeries,
    calculateMaturationHistory,
    smoothMaturationSeries,
    type MaturationHistory,
} from "../src/ts/maturation"
import { packRevlogs, RevlogHistory } from "../src/ts/packedRevlogs"
import { dayFromMs } from "../src/ts/revlogGraphs"
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
const card = (id: number) => ({ id, did: 1, odid: 0 }) as CardData
const review = (cid: number, offset: number, extra: Partial<Revlog> = {}): Revlog =>
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

test("first milestones include the lower boundary, exclude the upper boundary, and never repeat", () => {
    const history: MaturationHistory = {
        throughDay: 12,
        incompleteCards: 0,
        cards: [
            { introducedDay: 10, peaks: Float64Array.from([10, 7, 11, 30, 12, 31]) },
            { introducedDay: 10, peaks: Float64Array.from([10, 6, 11, 7, 12, 100]) },
            { introducedDay: 11, peaks: Float64Array.from([11, 50]) },
        ],
    }
    const series = buildMaturationSeries(history, 7, 30)
    expect(series.introduced.slice(10)).toEqual([2, 1, 0])
    expect(series.maturing.slice(10)).toEqual([1, 2, 0])
    expect(series.matured.slice(10)).toEqual([0, 1, 2])
    expect(series.maturingRatio.slice(10)).toEqual([50, 200, NaN])
    expect(series.maturedRatio.slice(10)).toEqual([0, 100, NaN])
    const changed = buildMaturationSeries(history, 30, 80)
    expect(changed.maturing.slice(10)).toEqual([0, 2, 1])
    expect(changed.matured.slice(10)).toEqual([0, 0, 1])
})

test("trailing counts average calendar days while ratios use the same window's totals", () => {
    const raw = {
        firstDay: 10,
        lastDay: 13,
        introduced: new Array(10).concat(1, 9, 0, 0),
        maturing: new Array(10).concat(10, 0, 2, 3),
        matured: new Array(10).concat(0, 5, 1, 1),
        maturingRatio: new Array(10).concat(1000, 0, NaN, NaN),
        maturedRatio: new Array(10).concat(0, 500 / 9, NaN, NaN),
    }
    const averaged = smoothMaturationSeries(raw, 2)
    expect(averaged.introduced.slice(10)).toEqual([1, 5, 4.5, 0])
    expect(averaged.maturing.slice(10)).toEqual([10, 5, 1, 2.5])
    expect(averaged.maturingRatio[11]).toBe(100)
    expect(averaged.maturingRatio[12]).toBeCloseTo(200 / 9)
    expect(averaged.maturingRatio[13]).toBeNaN()
    expect(averaged.maturedRatio[12]).toBeCloseTo(600 / 9)
    expect(raw.introduced.slice(10)).toEqual([1, 9, 0, 0])
    expect(smoothMaturationSeries(raw, 1)).toEqual(raw)
    expect(smoothMaturationSeries(raw, 7).maturingRatio[13]).toBe(150)
    expect(() => smoothMaturationSeries(raw, 0)).toThrow("Invalid maturation average window")
})

test("full FSRS-7 replay retains one introduction across resets and ignores cram/manual/future events", () => {
    const history = calculateMaturationHistory(
        [
            review(1, 0),
            review(2, 1, { type: 1, ivl: 100 }),
            review(3, 2),
            review(1, day, { type: 1, ivl: 3 }),
            review(1, day + 1, { type: 3, factor: 0, ease: 4, ivl: 36500 }),
            review(1, day + 2, { type: 4, ease: 0, ivl: 36500 }),
            review(1, day + 3, { type: 4, factor: 0, ease: 0, ivl: 0 }),
            review(1, 2 * day),
            review(1, 10 * day, { ease: 4, ivl: 36500 }),
        ],
        [card(1), card(2), card(3), card(4)],
        { 1: preset, 2: preset },
        start + 3 * day
    )
    expect(history.cards).toHaveLength(1)
    expect(history.incompleteCards).toBe(2)
    expect(history.cards[0].introducedDay).toBe(dayFromMs(start))
    const model = getFsrs(preset)
    const initial = model.nextState(null, 0, 3)
    expect(history.cards[0].peaks[1]).toBeCloseTo(intervalAtRetrievability(model, initial, 0.9), 6)
    const series = buildMaturationSeries(history, 0.0001, 0.0002)
    expect(series.introduced.filter(Boolean)).toEqual([1])
    expect(series.maturing.filter(Boolean)).toEqual([1])
    expect(series.matured.filter(Boolean)).toEqual([1])
})

test("a preset cutoff that discards initial learning cannot fabricate a lifetime first crossing", () => {
    const result = calculateMaturationHistory(
        [review(1, 0), review(1, 8 * day, { type: 1, ivl: 100 })],
        [card(1)],
        { 1: { ...preset, ignoreRevlogsBeforeDate: "2025-01-05" } },
        start + 9 * day
    )
    expect(result.cards).toEqual([])
    expect(result.incompleteCards).toBe(1)
})

test("unordered histories produce the same peaks and empty histories have no artificial ratios", () => {
    const reviews = [review(1, 0), review(1, day, { type: 1, ivl: 3 })]
    const chronological = calculateMaturationHistory(
        reviews,
        [card(1)],
        { 1: preset },
        start + 2 * day
    )
    expect(
        runStatsTaskLocally("maturation", [
            new RevlogHistory(packRevlogs(reviews)),
            [card(1)],
            { 1: preset },
            start + 2 * day,
        ])
    ).toEqual(chronological)
    expect(
        calculateMaturationHistory(
            [...reviews].reverse(),
            [card(1)],
            { 1: preset },
            start + 2 * day
        )
    ).toEqual(chronological)
    const empty = buildMaturationSeries({ cards: [], incompleteCards: 0, throughDay: 12 }, 7, 30)
    expect(empty.introduced[12]).toBe(0)
    expect(empty.maturingRatio[12]).toBeNaN()
    expect(() => buildMaturationSeries(chronological, 30, 7)).toThrow(
        "Invalid maturation thresholds"
    )
})
