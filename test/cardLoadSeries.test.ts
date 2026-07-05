import {
    CARD_LOAD_PERCENTILE_BUCKET_SIZE,
    YOUNG_STABILITY_THRESHOLD,
    cardIdsByCardMetric,
    cardIdsByCardMetricPercentile,
    currentCardLoad,
    loadByCardMetric,
    loadByCardMetricPercentile,
    type CardLoadSearchInput,
} from "../src/ts/cardLoadSeries"

function card(params: Partial<CardLoadSearchInput> = {}): CardLoadSearchInput {
    return {
        data: JSON.stringify({ s: 12 }),
        id: 1,
        ivl: 10,
        lapses: 0,
        queue: 2,
        reps: 1,
        ...params,
    }
}

test("load by card metric groups reviewed unsuspended cards by reps and lapses", () => {
    const cards = [
        card({ reps: 1, lapses: 0, ivl: 10 }),
        card({ reps: 2, lapses: 1, ivl: 5 }),
        card({ reps: 2, lapses: 1, ivl: 0 }),
        card({ reps: 3, lapses: 2, ivl: 1, queue: -1 }),
        card({ reps: 0, lapses: 0, ivl: 1 }),
    ]

    const reps = loadByCardMetric(cards, "reps")
    const lapses = loadByCardMetric(cards, "lapses")

    expect(reps[1]).toBeCloseTo(0.1)
    expect(reps[2]).toBeCloseTo(1.2)
    expect(reps[3]).toBeUndefined()
    expect(lapses[0]).toBeCloseTo(0.1)
    expect(lapses[1]).toBeCloseTo(1.2)
    expect(lapses[2]).toBeUndefined()
})

test("current card load treats zero intervals as daily load", () => {
    expect(currentCardLoad(card({ ivl: 0 }))).toBe(1)
})

test("load by card metric percentile groups cards into five percent slices by metric", () => {
    const cards = Array.from({ length: 20 }, (_, index) =>
        card({
            reps: index + 1,
            ivl: 100 / (index + 1),
        })
    )

    const percentileLoads = loadByCardMetricPercentile(cards, "reps")

    expect(CARD_LOAD_PERCENTILE_BUCKET_SIZE).toBe(5)
    expect(percentileLoads).toHaveLength(20)
    expect(percentileLoads[0]).toBeCloseTo(0.01)
    expect(percentileLoads[19]).toBeCloseTo(0.2)
})

test("load by card metric percentile accepts custom bucket sizes", () => {
    const cards = Array.from({ length: 20 }, (_, index) =>
        card({
            reps: index + 1,
            ivl: 100 / (index + 1),
        })
    )

    const percentileLoads = loadByCardMetricPercentile(cards, "reps", 10)

    expect(percentileLoads).toHaveLength(10)
    expect(percentileLoads[0]).toBeCloseTo(0.03)
    expect(percentileLoads[9]).toBeCloseTo(0.39)
})

test("load by card metric percentile sorts matching metric values by ascending load", () => {
    const cards = [
        card({ id: 1, lapses: 0, ivl: 1 }),
        card({ id: 2, lapses: 0, ivl: 10 }),
        card({ id: 3, lapses: 0, ivl: 5 }),
        card({ id: 4, lapses: 0, ivl: 20 }),
    ]

    const percentileLoads = loadByCardMetricPercentile(cards, "lapses", 25)

    expect(percentileLoads).toStrictEqual([0.05, 0.1, 0.2, 1])
})

test("card ids by percentile returns the exact selected percentile bucket", () => {
    const cards = Array.from({ length: 20 }, (_, index) =>
        card({
            id: index + 1,
            reps: index + 1,
            ivl: 10,
        })
    )

    expect(cardIdsByCardMetricPercentile(cards, "reps", 2, 2)).toStrictEqual([3, 4])
})

test("card ids by percentile can include cumulative buckets", () => {
    const cards = Array.from({ length: 20 }, (_, index) =>
        card({
            id: index + 1,
            reps: index + 1,
            ivl: 10,
        })
    )

    expect(cardIdsByCardMetricPercentile(cards, "reps", 3, 1, true)).toStrictEqual([1, 2, 3, 4])
})

test("card ids by percentile accepts custom bucket sizes", () => {
    const cards = Array.from({ length: 20 }, (_, index) =>
        card({
            id: index + 1,
            reps: index + 1,
            ivl: 10,
        })
    )

    expect(cardIdsByCardMetricPercentile(cards, "reps", 1, 1, false, 10)).toStrictEqual([3, 4])
})

test("card ids by percentile sorts matching metric values by ascending load", () => {
    const cards = [
        card({ id: 1, lapses: 0, ivl: 1 }),
        card({ id: 2, lapses: 0, ivl: 10 }),
        card({ id: 3, lapses: 0, ivl: 5 }),
        card({ id: 4, lapses: 0, ivl: 20 }),
    ]

    expect(cardIdsByCardMetricPercentile(cards, "lapses", 0, 4, false, 25)).toStrictEqual([
        4, 2, 3, 1,
    ])
})

test("load by card metric can include only young cards by S90 stability", () => {
    const cards = [
        card({ reps: 1, ivl: 10, data: JSON.stringify({ s: YOUNG_STABILITY_THRESHOLD - 1 }) }),
        card({ reps: 1, ivl: 5, data: JSON.stringify({ s: YOUNG_STABILITY_THRESHOLD }) }),
        card({ reps: 1, ivl: 2, data: "{}" }),
    ]

    expect(loadByCardMetric(cards, "reps", { onlyYoung: true })[1]).toBeCloseTo(0.1)
})

test("percentile load can include only young cards by S90 stability", () => {
    const cards = [
        card({ id: 1, lapses: 0, ivl: 10, data: JSON.stringify({ s: 10 }) }),
        card({ id: 2, lapses: 0, ivl: 5, data: JSON.stringify({ s: 20 }) }),
        card({ id: 3, lapses: 0, ivl: 1, data: JSON.stringify({ s: 21 }) }),
    ]

    expect(loadByCardMetricPercentile(cards, "lapses", 50, { onlyYoung: true })).toStrictEqual([
        0.1, 0.2,
    ])
})

test("card ids by metric can include only young cards by S90 stability", () => {
    const cards = [
        card({ id: 1, reps: 1, data: JSON.stringify({ s: 10 }) }),
        card({ id: 2, reps: 1, data: JSON.stringify({ s: 21 }) }),
        card({ id: 3, reps: 2, data: JSON.stringify({ s: 20 }) }),
    ]

    expect(cardIdsByCardMetric(cards, "reps", 1, 2, false, { onlyYoung: true })).toStrictEqual([
        1, 3,
    ])
})

test("card ids by percentile can include only young cards by S90 stability", () => {
    const cards = [
        card({ id: 1, lapses: 0, ivl: 10, data: JSON.stringify({ s: 10 }) }),
        card({ id: 2, lapses: 0, ivl: 5, data: JSON.stringify({ s: 20 }) }),
        card({ id: 3, lapses: 0, ivl: 1, data: JSON.stringify({ s: 21 }) }),
    ]

    expect(
        cardIdsByCardMetricPercentile(cards, "lapses", 0, 2, false, 50, { onlyYoung: true })
    ).toStrictEqual([1, 2])
})
