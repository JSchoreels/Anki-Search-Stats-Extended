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

// Reference states and probabilities from the previous implementation before removing it.
test.each([
    [
        17,
        [
            [0.212, 8.0801, 0.48116103],
            [0.212, 8.0775998, 0.48116103],
            [1.67727683, 8.0751021, 0.83931397],
            [0.64598523, 9.57654272, 0.69182213],
            [0.64598523, 9.57254608, 0.69182213],
            [8.9848122, 9.40156711, 0.96299908],
        ],
    ],
    [
        19,
        [
            [0.212, 6.4133, 0.48116103],
            [0.22275272, 6.40211507, 0.49034191],
            [2.54777327, 6.39094132, 0.88519723],
            [0.77818053, 8.79895532, 0.72465792],
            [0.81765014, 8.78538473, 0.73310915],
            [15.44919833, 8.36474527, 0.97797487],
        ],
    ],
    [
        21,
        [
            [0.212, 6.4133, 0.65950321],
            [0.24668919, 6.40211507, 0.67395783],
            [2.02147724, 6.39094132, 0.87067664],
            [0.63848465, 8.79895532, 0.76657445],
            [0.69096924, 8.78538473, 0.7742298],
            [8.35093519, 8.36474527, 0.95454067],
        ],
    ],
])("preserves the existing %i-weight model's replay and probabilities", (length, expected) => {
    const model = getFsrsForParams(FSRS6_DEFAULT_WEIGHTS.slice(0, length))
    let state: FsrsMemoryState | null = null
    const reviews = [
        [0, 1],
        [0, 3],
        [1, 3],
        [8, 1],
        [0, 3],
        [21, 4],
    ]
    for (const [index, [elapsed, rating]] of reviews.entries()) {
        state = model.nextState(state, elapsed, rating)
        const [stability, difficulty, retrievability] = expected[index]
        expect(state.stability).toBeCloseTo(stability, 6)
        expect(state.difficulty).toBeCloseTo(difficulty, 6)
        expect(model.retrievability(state, 3)).toBeCloseTo(retrievability, 6)
    }
})

test("rejects the unsupported 35-weight FSRS-7 preview layout", () => {
    expect(() => getFsrsForParams(Array(35).fill(1))).toThrow(
        "Unsupported or non-finite FSRS parameters"
    )
})

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
