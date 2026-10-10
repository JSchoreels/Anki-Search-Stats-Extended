import { FSRS7_DEFAULT_WEIGHTS } from "ts-fsrs/models/fsrs-7"
import { ankiDayFromMs, ankiDaySnapshotMs, ankiDayToMs } from "../src/ts/ankiDay"
import type { CardData, Revlog } from "../src/ts/cardData"
import type { DeckConfig, ResolvedFsrsPreset } from "../src/ts/config"
import {
    buildForgettingCurve,
    computeStabilityForSeries,
    createSeriesPredictor,
    type PresetCurveModel,
} from "../src/ts/forgettingCurveData"
import {
    prepareFsrsReplay,
    selectFsrsHistory,
    stateFromIncompleteHistory,
} from "../src/ts/fsrsHistory"
import { getFsrsForParams } from "../src/ts/fsrsModel"
import { getMemorisedDays } from "../src/ts/MemorisedBar"
import { dayFromMs } from "../src/ts/revlogGraphs"
import reference from "./fixtures/fsrs-native-reference.json"
import { reviewSnapshot } from "./reviewSnapshot"

const weights = [...FSRS7_DEFAULT_WEIGHTS]
const config = { id: 1, fsrsVersion: 0, fsrsParams7: weights, sm2Retention: 0.9 } as DeckConfig
const card = { id: 1, nid: 1, did: 1, reps: 2, data: "{}" } as CardData
const start = new Date(2026, 8, 1, 12).getTime()
function review(offset: number, ease = 3, type = 1, ivl = 10, factor = 200): Revlog {
    return { id: start + offset, cid: 1, ease, time: 1000, type, ivl, factor, lastIvl: 1 } as Revlog
}

test.each(reference.cases.map((entry, index) => [index, entry] as const))(
    "incomplete-history state and replay match pinned native FSRS case %s",
    (_, { input, expected }) => {
        const model = getFsrsForParams(input.weights)
        let state = stateFromIncompleteHistory(
            model,
            review(0, 3, 1, input.interval, input.factor),
            input.retention
        )
        expect(
            Math.abs(state.stability - expected.starting!.stability) /
                Math.max(1, expected.starting!.stability)
        ).toBeLessThan(0.0002)
        expect(state.difficulty).toBeCloseTo(expected.starting!.difficulty, 4)
        if (model.version === "seven")
            expect(
                Math.abs(state.stabilityFast! - expected.starting!.stabilityFast) /
                    Math.max(1, expected.starting!.stabilityFast)
            ).toBeLessThan(0.0002)
        for (const r of input.reviews) state = model.nextState(state, r.delta, r.rating)
        const elapsed = model.version === "seven" ? input.elapsed : Math.round(input.elapsed)
        expect(Math.abs(model.retrievability(state, elapsed) - expected.r)).toBeLessThan(0.00002)
    }
)

test("history selection honors native cutoff, interday bootstrap, reset and cram rules", () => {
    const cutoff = start + 86400000
    const history = [
        review(0, 3, 0, -600),
        review(600000, 3),
        review(2 * 86400000, 3, 1, -600),
        review(3 * 86400000),
        review(4 * 86400000, 3, 3, 30, 0),
        review(5 * 86400000),
    ]
    const selected = selectFsrsHistory(history, cutoff)
    expect(selected.complete).toBe(false)
    expect(selected.reviews.map((r) => r.id - start)).toEqual([3 * 86400000, 5 * 86400000])
    expect(
        selectFsrsHistory([...history, review(6 * 86400000, 0, 4, 0, 0)], cutoff).reviews
    ).toEqual([])
    const postReset = review(7 * 86400000, 4, 0, -600)
    expect(
        selectFsrsHistory([...history, review(6 * 86400000, 0, 4, 0, 0), postReset], cutoff)
    ).toEqual({ reviews: [postReset], complete: true })
})

test("a missing-history first grade is represented once by its post-review state", async () => {
    const logs = [review(0, 3, 1, 30, 2500), review(86400000)]
    const model = getFsrsForParams(weights)
    const initial = stateFromIncompleteHistory(model, logs[0], 0.9)
    const steps = Array.from(
        prepareFsrsReplay(logs, () => config),
        (step) => ({ ...step, review: reviewSnapshot(step.review) })
    )
    expect(steps[0].startingState).toEqual(initial)
    const stats = await getMemorisedDays(
        logs,
        [card],
        { 1: config },
        { 1: 1 },
        [],
        2,
        2,
        {},
        undefined,
        start + 2 * 86400000
    )
    const expected = model.nextState(initial, 1, 3)
    expect(stats.retrievabilityDays[dayFromMs(start + 2 * 86400000)]).toBeCloseTo(
        model.retrievability(expected, 1),
        9
    )
    expect(stats.calibration_samples.revlogIds.includes(logs[0].id)).toBe(false)
    expect(stats.day_means[dayFromMs(start)]).toBeCloseTo(30, 4)
})

test("the resolved preset supplies historical retention and the UTC cutoff", () => {
    const preset = {
        params: weights,
        fsrsVersion: "seven",
        historicalRetention: 0.85,
        ignoreRevlogsBeforeDate: "2026-09-02",
    } as ResolvedFsrsPreset
    const logs = [review(0, 3, 0), review(2 * 86400000, 3, 1, 30, 2500), review(3 * 86400000)]
    const steps = Array.from(
        prepareFsrsReplay(logs, () => preset),
        (step) => ({ ...step, review: reviewSnapshot(step.review) })
    )
    expect(steps).toHaveLength(2)
    expect(steps[0].review).toEqual(logs[1])
    expect(getFsrsForParams(weights).retrievability(steps[0].startingState!, 30)).toBeCloseTo(
        0.85,
        6
    )
})

test("Anki day boundaries use the local rollover and each date's own UTC offset", () => {
    const rollover = 4
    const boundary = new Date(2026, 2, 29, rollover).getTime()
    const day = Date.UTC(2026, 2, 29) / 86400000
    expect(ankiDayFromMs(boundary - 1, rollover)).toBe(day - 1)
    expect(ankiDayFromMs(boundary, rollover)).toBe(day)
    expect(ankiDayToMs(day, rollover)).toBe(boundary)
    expect(ankiDaySnapshotMs(day - 1, rollover, boundary + 1000)).toBe(boundary - 1)
    expect(ankiDaySnapshotMs(day, rollover, boundary + 1000)).toBe(boundary + 1000)
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === "Europe/Brussels") {
        expect((ankiDayToMs(day, 4) - ankiDayToMs(day - 1, 4)) / 3600000).toBe(23)
        const autumn = Date.UTC(2026, 9, 25) / 86400000
        expect((ankiDayToMs(autumn, 4) - ankiDayToMs(autumn - 1, 4)) / 3600000).toBe(25)
    }
})

test("daily Memorised uses the final same-day review, and today uses now", async () => {
    const model = getFsrsForParams(weights)
    const logs = [review(0, 1, 0), review(600000, 3, 0)]
    const now = start + 3600000
    const stats = await getMemorisedDays(
        logs,
        [card],
        { 1: config },
        { 1: 1 },
        [],
        2,
        2,
        {},
        undefined,
        now
    )
    const state = model.nextState(model.nextState(null, 0, 1), 600000 / 86400000, 3)
    expect(stats.retrievabilityDays[dayFromMs(start)]).toBeCloseTo(
        model.retrievability(state, 3000000 / 86400000),
        9
    )
    expect(stats.totalCards[dayFromMs(start)]).toBe(1)
})

test("a reset closes historical state without carrying a stale prediction past it", async () => {
    const logs = [review(0, 3, 0), review(86400000, 0, 4, 0, 0)]
    const stats = await getMemorisedDays(
        logs,
        [card],
        { 1: config },
        { 1: 1 },
        [],
        2,
        2,
        {},
        undefined,
        start + 2 * 86400000
    )
    expect(stats.totalCards[dayFromMs(start)]).toBe(1)
    expect(stats.retrievabilityDays[dayFromMs(logs[1].id)]).toBeUndefined()
    expect(stats.day_means[dayFromMs(logs[1].id)]).toBe(0)
})

test("mixed-preset fitting keeps separate states and weights predictions by review count", () => {
    const other = [...weights]
    other[23] = 0.5
    other[27] = 0.8
    const mixture: PresetCurveModel = { models: [weights, other], cards: { 1: 0, 2: 1 } }
    const samples = [1, 2, 3, 4].flatMap((delta) =>
        [1, 1, 1, 2].map((cid) => ({ cid, delta, firstRating: 3, recall: delta < 3 ? 1 : 0 }))
    )
    const series = computeStabilityForSeries(
        buildForgettingCurve(samples, { disableOutlierFiltering: true }),
        samples,
        mixture
    )
    const entry = series.find((s) => s.rating === 3)!
    expect(entry.fits!.map((fit) => fit.count)).toEqual([12, 4])
    const separate = mixture.models.map(
        (model, index) =>
            computeStabilityForSeries(
                buildForgettingCurve(
                    samples.filter((s) => s.cid === index + 1),
                    { disableOutlierFiltering: true }
                ),
                samples.filter((s) => s.cid === index + 1),
                model
            ).find((s) => s.rating === 3)!
    )
    const actual = createSeriesPredictor(entry, mixture)(7)
    const expected =
        createSeriesPredictor(separate[0], weights)(7) * 0.75 +
        createSeriesPredictor(separate[1], other)(7) * 0.25
    expect(actual).toBeCloseTo(expected, 12)
})
