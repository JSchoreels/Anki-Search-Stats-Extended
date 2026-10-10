import { parseReviewRetrievabilityResponse } from "../src/ts/calibrationPredictions"
import {
    alignPredictions,
    calibrationSamplesFrom,
    countPredictions,
    EMPTY_CALIBRATION_SAMPLES,
    sampleCount,
} from "../src/ts/calibrationSamples"

test("samples preserve index order and millisecond ids in typed columns", () => {
    const list = [
        { revlogId: 1_790_800_000_123, cardId: 1_600_000_000_456, actual: 1 },
        { revlogId: 1_790_700_000_789, cardId: 1_600_000_000_457, actual: 0 },
    ]
    const samples = calibrationSamplesFrom(list)
    expect(samples).toEqual({
        revlogIds: new Float64Array(list.map((sample) => sample.revlogId)),
        cardIds: new Float64Array(list.map((sample) => sample.cardId)),
        actual: new Uint8Array([1, 0]),
    })
    expect(sampleCount(samples)).toBe(2)
    list[0].revlogId = 0
    expect(samples.revlogIds[0]).toBe(1_790_800_000_123)
    expect(calibrationSamplesFrom([])).toEqual(EMPTY_CALIBRATION_SAMPLES)
    expect(sampleCount(EMPTY_CALIBRATION_SAMPLES)).toBe(0)
})

test.each([false, true])(
    "alignment keeps zero, repeats ids and ignores extra ids (Map: %s)",
    (map) => {
        const samples = calibrationSamplesFrom(
            [12, 10, 11, 12].map((revlogId) => ({
                revlogId,
                cardId: revlogId,
                actual: 1,
            }))
        )
        const entries: [number, number][] = [
            [10, 0],
            [12, 0.8],
            [99, 0.9],
        ]
        const aligned = alignPredictions(
            samples,
            map ? new Map(entries) : Object.fromEntries(entries)
        )
        expect(aligned).toEqual(new Float64Array([0.8, 0, NaN, 0.8]))
        expect(alignPredictions(EMPTY_CALIBRATION_SAMPLES, new Map(entries))).toHaveLength(0)
    }
)

test("prediction counts accept only finite probabilities in [0, 1]", () => {
    expect(
        countPredictions(new Float64Array([0, 1, 0.42, NaN, Infinity, -Infinity, -0.1, 1.1]))
    ).toBe(3)
    expect(countPredictions(new Float64Array(0))).toBe(0)
})

test("response validation preserves the original coercion, filtering and response-wide count", () => {
    const samples = calibrationSamplesFrom(
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((revlogId) => ({
            revlogId,
            cardId: revlogId,
            actual: 1,
        }))
    )
    const parsed = parseReviewRetrievabilityResponse(
        JSON.stringify({
            column: "cache",
            data: [
                [1, "0.42"],
                [2, null],
                [3, "invalid"],
                [4, "Infinity"],
                [5, 0],
                [6, ""],
                [7, "  "],
                [8, true],
                [9, 1.2],
                [999, -0.1],
                [1, "0.6"],
                [1, "invalid"],
            ],
            roles: ["validation_fold", null, 42, "", "post_optimization"],
            role_counts: {
                validation_fold: 2,
                zero: 0,
                negative: -1,
                fraction: 1.5,
                string: "2",
                nil: null,
            },
            warnings: ["warning", "", null, 42, " "],
            refresh_after_fsrs: true,
        }),
        samples
    )
    expect(parsed).toEqual({
        column: "cache",
        predictions: new Float64Array([0.6, NaN, NaN, NaN, 0, 0, 0, NaN, 1.2]),
        responsePredictionCount: 6,
        roles: ["validation_fold", "", "post_optimization"],
        roleCounts: { validation_fold: 2, zero: 0 },
        warnings: ["warning", " "],
        refreshAfterFsrs: true,
    })
    expect(countPredictions(parsed.predictions)).toBe(4)
})

test.each([false, "true", 1, null, undefined])("refresh requires literal true (%s)", (refresh) => {
    expect(
        parseReviewRetrievabilityResponse(
            JSON.stringify({ refresh_after_fsrs: refresh }),
            EMPTY_CALIBRATION_SAMPLES
        )
    ).toEqual({
        column: null,
        predictions: new Float64Array(0),
        responsePredictionCount: 0,
        roles: [],
        roleCounts: {},
        warnings: [],
    })
})

test("invalid JSON still fails parsing", () => {
    expect(() => parseReviewRetrievabilityResponse("invalid", EMPTY_CALIBRATION_SAMPLES)).toThrow(
        SyntaxError
    )
})

test("response alignment handles shuffled and repeated sample IDs without changing their order", () => {
    const ids = [1700000000012, 1700000000010, 1700000000011, 1700000000012]
    const samples = calibrationSamplesFrom(
        ids.map((revlogId) => ({ revlogId, cardId: 1, actual: 1 }))
    )
    const parsed = parseReviewRetrievabilityResponse(
        JSON.stringify({
            data: [
                [1700000000012, 0.2],
                [1700000000099, 0.9],
                [1700000000010, 0],
                [1700000000012, 0.8],
                [1700000000012, "invalid"],
            ],
        }),
        samples
    )
    expect(parsed.predictions).toEqual(new Float64Array([0.8, 0, NaN, 0.8]))
    expect(parsed.responsePredictionCount).toBe(3)
    expect(Array.from(samples.revlogIds)).toEqual(ids)
})
