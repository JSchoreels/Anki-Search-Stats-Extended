import { recallGainPerHundredReviews } from "../src/ts/memorisedPerReview"

test("daily gain is based on the reviewed cards, with gaps on days without answers", () => {
    const result = recallGainPerHundredReviews([1, 0, 2, -0.5], [10, 0, 20, 10])
    expect(result[0]).toBe(10)
    expect(result[1]).toBeNaN()
    expect(result[2]).toBe(10)
    expect(result[3]).toBe(-5)
})

test("rolling gain uses total modeled gains and answers, excluding no-review days", () => {
    const result = recallGainPerHundredReviews([1, 0, 2, 0.5], [10, 0, 20, 10], 3)
    expect(result[1]).toBeNaN()
    expect(result[2]).toBe(10)
    expect(result[3]).toBeCloseTo(100 * (2.5 / 30))
})

test("rolling gain divides totals rather than averaging daily ratios", () => {
    expect(recallGainPerHundredReviews([1, 1], [10, 30], 2)[1]).toBe(5)
})

test("missing estimates contribute neither gains nor answers", () => {
    const result = recallGainPerHundredReviews([1, Number.NaN, 2], [10, 40, 20], 3)
    expect(result[1]).toBeNaN()
    expect(result[2]).toBe(10)
})

test("moving-average window must be a positive integer", () => {
    expect(() => recallGainPerHundredReviews([], [], 0)).toThrow(/positive integer/)
    expect(() => recallGainPerHundredReviews([], [], 1.5)).toThrow(/positive integer/)
})

test("review history alone does not create a model series", () => {
    expect(recallGainPerHundredReviews([], [10, 20])).toEqual([])
})
