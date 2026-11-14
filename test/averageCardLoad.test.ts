import { averageForRange, cardMetricBuckets } from "../src/ts/averageCardMetric"

test("average load uses all reviewed cards in a grouped lapse range", () => {
    const cards = [
        { reps: 3, lapses: 1, ivl: 2, queue: 2 },
        { reps: 3, lapses: 1, ivl: 4, queue: 2 },
        { reps: 7, lapses: 2, ivl: 10, queue: 2 },
        { reps: 0, lapses: 1, ivl: 1, queue: 0 },
        { reps: 2, lapses: 1, ivl: 1, queue: -1 },
    ]
    const buckets = cardMetricBuckets(cards, "lapses", false)

    expect(averageForRange(buckets, 1, 1)).toBeCloseTo(0.375)
    expect(averageForRange(buckets, 1, 2)).toBeCloseTo(0.85 / 3)
    expect(averageForRange(buckets, 4, 1)).toBe(0)
    expect(averageForRange(cardMetricBuckets(cards, "lapses", true), 1, 1)).toBeCloseTo(1.75 / 3)
})

test("repetition buckets use current intervals and a one-day minimum for learning cards", () => {
    const cards = [
        { reps: 3, lapses: 1, ivl: -60, queue: 1 },
        { reps: 4, lapses: 0, ivl: 5, queue: 2 },
    ]
    const buckets = cardMetricBuckets(cards, "reps", false)

    expect(averageForRange(buckets, 3, 2)).toBeCloseTo(0.6)
})

test("averages repetition counts and the original lapses-plus-one ratio by card", () => {
    const cards = [
        { reps: 4, lapses: 0, ivl: 2, queue: 2 },
        { reps: 6, lapses: 1, ivl: 4, queue: 2 },
        { reps: 9, lapses: 2, ivl: 9, queue: 2 },
    ]
    expect(
        averageForRange(cardMetricBuckets(cards, "lapses", false, "repetitions"), 0, 3)
    ).toBeCloseTo(19 / 3)
    expect(
        averageForRange(cardMetricBuckets(cards, "lapses", false, "repetitionsPerLapse"), 0, 3)
    ).toBeCloseTo(10 / 3)
})
