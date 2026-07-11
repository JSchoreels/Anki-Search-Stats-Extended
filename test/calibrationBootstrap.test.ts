import { cardBootstrapConfidenceIntervals } from "../src/ts/calibrationBootstrap"

test("card bootstrap keeps reviews from the same card clustered", () => {
    const observations = [
        ...Array.from({ length: 10 }, () => ({ cardId: 1, bin: 0, actual: 1 })),
        ...Array.from({ length: 10 }, () => ({ cardId: 2, bin: 0, actual: 0 })),
    ]

    const intervals = cardBootstrapConfidenceIntervals(observations, 1, 1_000)

    expect(intervals[0]).toEqual([0, 1])
})

test("card bootstrap is deterministic for stable graph rendering", () => {
    const observations = [
        { cardId: 1, bin: 0, actual: 1 },
        { cardId: 2, bin: 0, actual: 0 },
        { cardId: 3, bin: 0, actual: 1 },
    ]

    expect(cardBootstrapConfidenceIntervals(observations, 1, 100)).toEqual(
        cardBootstrapConfidenceIntervals(observations, 1, 100)
    )
})

test("card bootstrap returns sparse intervals for populated bins", () => {
    const intervals = cardBootstrapConfidenceIntervals(
        [
            { cardId: 1, bin: 1, actual: 1 },
            { cardId: 2, bin: 1, actual: 0 },
        ],
        3,
        100
    )

    expect(intervals[0]).toBeUndefined()
    expect(intervals[1]).toEqual([0, 1])
    expect(intervals[2]).toBeUndefined()
})
