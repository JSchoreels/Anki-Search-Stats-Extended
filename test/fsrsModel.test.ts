import { fsrs as previousFsrs } from "ts-fsrs-legacy-preview"
import { FSRS6_DEFAULT_WEIGHTS } from "ts-fsrs/models/fsrs-6"
import { curve, FSRS7_DEFAULT_WEIGHTS } from "ts-fsrs/models/fsrs-7"
import { forgettingCurveWithModel } from "../src/ts/forgettingCurveData"
import {
    elapsedFsrsDays,
    getFsrsForParams,
    intervalAtRetrievability,
    memoryStateFromCardData,
    type FsrsMemoryState,
} from "../src/ts/fsrsModel"

const weights7 = [...FSRS7_DEFAULT_WEIGHTS]
const previewWeights = [
    0.041, 2.4175, 4.1283, 11.9709, 5.6385, 0.4468, 3.262, 2.3054, 0.1688, 1.3325, 0.3524, 0.0049,
    0.7503, 0.0896, 0.6625, 1.3, 0.882, 0.3072, 3.5875, 0.303, 0.0107, 0.2279, 2.6413, 0.5594, 1.3,
    2.5, 1.0, 0.0723, 0.1634, 0.5, 0.9555, 0.2245, 0.6232, 0.1362, 0.3862,
]

test("FSRS-7 matches the fsrs-rs and benchmark memory-state reference sequence", () => {
    const model = getFsrsForParams(weights7)
    let state: FsrsMemoryState | null = null
    // fsrs-rs c9562d6 / srs-benchmark b4b0254, also checked by upstream ts-fsrs.
    const reviews = [
        { elapsed: 0, rating: 1, stability: 0.1104, fast: 0.0883, difficulty: 6.1686 },
        { elapsed: 0, rating: 3, stability: 0.1104, fast: 0.0883, difficulty: 6.1092 },
        { elapsed: 1, rating: 3, stability: 0.9169, fast: 44.4442, difficulty: 6.0504 },
        { elapsed: 3, rating: 3, stability: 3.5338, fast: 193.5973, difficulty: 5.9922 },
        { elapsed: 8, rating: 3, stability: 10.186, fast: 407.6265, difficulty: 5.9346 },
        { elapsed: 21, rating: 3, stability: 25.9857, fast: 700.5589, difficulty: 5.8775 },
    ]
    for (const review of reviews) {
        state = model.nextState(state, review.elapsed, review.rating)
        expect(state.stability).toBeCloseTo(review.stability, 4)
        expect(state.stabilityFast).toBeCloseTo(review.fast, 4)
        expect(state.difficulty).toBeCloseTo(review.difficulty, 4)
    }
})

test("FSRS-7 recall and S90 use both stability traces and actual difficulty", () => {
    const model = getFsrsForParams(weights7)
    const state = { stability: 10, stabilityFast: 2, difficulty: 8 }
    expect(model.retrievability(state, 3)).toBeCloseTo(curve(weights7, 3, state).retrievability, 10)
    expect(model.retrievability(state, 3)).not.toBeCloseTo(
        model.retrievability({ ...state, stabilityFast: 10, difficulty: 5 }, 3),
        4
    )
    const s90 = intervalAtRetrievability(model, state, 0.9)
    expect(model.retrievability(state, s90)).toBeCloseTo(0.9, 3)
    expect(s90).not.toBeCloseTo(
        intervalAtRetrievability(model, { ...state, stabilityFast: 20 }, 0.9),
        4
    )
    expect(() => model.retrievability({ stability: 10, difficulty: 8 }, 3)).toThrow(
        "fast stability"
    )
})

test("FSRS-7 preserves fractional review time across the collection rollover", () => {
    const previous = new Date(2026, 9, 4, 3, 55)
    const now = new Date(2026, 9, 4, 4, 5)
    const rollover = 4 * 3600000
    const model7 = getFsrsForParams(weights7)
    expect(elapsedFsrsDays(model7, previous, now, rollover)).toBeCloseTo(10 / 1440, 10)
    expect(elapsedFsrsDays(getFsrsForParams(FSRS6_DEFAULT_WEIGHTS), previous, now, rollover)).toBe(
        1
    )
    const state = model7.nextState(null, 0, 1)
    expect(model7.nextState(state, 10 / 1440, 3).stabilityFast).not.toBeCloseTo(
        model7.nextState(state, 0, 3).stabilityFast!,
        5
    )
})

test.each([17, 19, 21, 35])(
    "preserves the existing %i-weight model's replay and probabilities",
    (length) => {
        const weights = length === 35 ? previewWeights : FSRS6_DEFAULT_WEIGHTS.slice(0, length)
        const model = getFsrsForParams(weights)
        const previous = previousFsrs({ w: weights, enable_short_term: true, enable_fuzz: false })
        let actual: FsrsMemoryState | null = null
        let expected: FsrsMemoryState | null = null
        for (const [elapsed, rating] of [
            [0, 1],
            [0, 3],
            [1, 3],
            [8, 1],
            [0, 3],
            [21, 4],
        ]) {
            actual = model.nextState(actual, elapsed, rating)
            expected = previous.next_state(expected, elapsed, rating)
            expect(actual.stability).toBeCloseTo(expected.stability, 6)
            expect(actual.difficulty).toBeCloseTo(expected.difficulty, 6)
            expect(model.retrievability(actual, 3)).toBeCloseTo(
                previous.forgetting_curve(3, expected.stability),
                6
            )
        }
    }
)

test("current FSRS-7 state reads stored slow/fast stability without inventing missing values", () => {
    const model = getFsrsForParams(weights7)
    expect(memoryStateFromCardData(model, { s: 4, s_int: 12, s_fast: 3, d: 8 })).toEqual({
        stability: 12,
        stabilityFast: 3,
        difficulty: 8,
    })
    expect(memoryStateFromCardData(model, { s: 4, s_int: 12, d: 8 })).toBeUndefined()
    expect(memoryStateFromCardData(model, { s: 4, s_fast: 3, d: 8 })).toBeUndefined()
})

test("first-review curve fitting preserves the initialized trace ratio and rating-specific difficulty", () => {
    const initial = getFsrsForParams(weights7).nextState(null, 0, 1)
    const fitted = {
        stability: 0.25,
        stabilityFast: (initial.stabilityFast! * 0.25) / initial.stability,
        difficulty: initial.difficulty,
    }
    const expected = curve(weights7, 10 / 1440, fitted).retrievability
    expect(forgettingCurveWithModel(weights7, 10 / 1440, 0.25, 1)).toBeCloseTo(expected, 10)
    expect(forgettingCurveWithModel(weights7, 10, 0.25 * 1440, 1, 1 / 1440)).toBeCloseTo(
        expected,
        10
    )
})
