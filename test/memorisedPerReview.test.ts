import { netMemorisedPerHundredReviews } from "../src/ts/memorisedPerReview"

test("daily net memorised per review preserves no-review gaps and negative values", () => {
    const result = netMemorisedPerHundredReviews([100, 110, 108, 104], [0, 10, 0, 20])

    expect(result[0]).toBeNaN()
    expect(result[1]).toBe(100)
    expect(result[2]).toBeNaN()
    expect(result[3]).toBe(-20)
})

test("moving average uses rolling totals and includes decay on no-review days", () => {
    const result = netMemorisedPerHundredReviews([100, 110, 108, 104], [0, 10, 0, 20], 3)

    expect(result[1]).toBe(100)
    expect(result[2]).toBeNaN()
    expect(result[3]).toBeCloseTo(100 * (4 / 30))
})

test("moving average divides summed changes by summed reviews instead of daily ratios", () => {
    const result = netMemorisedPerHundredReviews([100, 110, 120], [0, 10, 30], 2)

    expect(result[2]).toBe(50)
})

test("unavailable model days contribute neither changes nor reviews", () => {
    const result = netMemorisedPerHundredReviews(
        [Number.NaN, 100, 110, Number.NaN, 120, 130],
        [0, 10, 30, 40, 50, 20],
        5
    )

    expect(result[3]).toBeNaN()
    expect(result[4]).toBeNaN()
    expect(result[5]).toBe(40)
})

test("moving-average window must be a positive integer", () => {
    expect(() => netMemorisedPerHundredReviews([], [], 0)).toThrow(/positive integer/)
    expect(() => netMemorisedPerHundredReviews([], [], 1.5)).toThrow(/positive integer/)
})

test("review history alone does not create a model series", () => {
    expect(netMemorisedPerHundredReviews([], [0, 10, 20])).toEqual([])
})
