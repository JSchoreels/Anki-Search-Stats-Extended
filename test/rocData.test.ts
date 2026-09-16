import { buildRocData } from "../src/ts/rocData"

test("ROC compares FSRS and RWKV on the same paired reviews", () => {
    const data = buildRocData(
        [
            { revlogId: 1, cardId: 1, actual: 1 },
            { revlogId: 2, cardId: 2, actual: 1 },
            { revlogId: 3, cardId: 3, actual: 0 },
            { revlogId: 4, cardId: 4, actual: 0 },
        ],
        { 1: 0.9, 2: 0.8, 3: 0.2, 4: 0.1 },
        { 1: 0.1, 2: 0.2, 3: 0.8, 4: 0.9 }
    )

    expect(data).toMatchObject({ count: 4, positiveCount: 2, negativeCount: 2 })
    expect(data.fsrs.auc).toBeCloseTo(1)
    expect(data.rwkv.auc).toBeCloseTo(0)
    expect(data.fsrs.points[0]).toEqual({
        falsePositiveRate: 0,
        truePositiveRate: 0,
        threshold: Number.POSITIVE_INFINITY,
    })
    expect(data.fsrs.points.at(-1)).toMatchObject({
        falsePositiveRate: 1,
        truePositiveRate: 1,
    })
})

test("ROC processes tied predictions together and gives them half AUC credit", () => {
    const data = buildRocData(
        [
            { revlogId: 1, cardId: 1, actual: 1 },
            { revlogId: 2, cardId: 2, actual: 0 },
        ],
        { 1: 0.5, 2: 0.5 },
        { 1: 0.5, 2: 0.5 }
    )

    expect(data.fsrs.points).toHaveLength(2)
    expect(data.fsrs.points[1]).toEqual({
        falsePositiveRate: 1,
        truePositiveRate: 1,
        threshold: 0.5,
    })
    expect(data.fsrs.auc).toBeCloseTo(0.5)
    expect(data.rwkv.auc).toBeCloseTo(0.5)
})

test("ROC excludes reviews without two valid predictions", () => {
    const data = buildRocData(
        [
            { revlogId: 1, cardId: 1, actual: 1 },
            { revlogId: 2, cardId: 2, actual: 0 },
            { revlogId: 3, cardId: 3, actual: 0 },
            { revlogId: 4, cardId: 4, actual: 2 },
        ],
        { 1: 0.8, 2: 0.2, 3: 1.1, 4: 0.4 },
        { 1: 0.7, 2: 0.3, 3: 0.2, 4: 0.5 }
    )

    expect(data).toMatchObject({ count: 2, positiveCount: 1, negativeCount: 1 })
    expect(data.fsrs.auc).toBeCloseTo(1)
})

test("ROC AUC is unavailable when the paired sample has only one outcome class", () => {
    const data = buildRocData([{ revlogId: 1, cardId: 1, actual: 1 }], { 1: 0.8 }, { 1: 0.7 })

    expect(data).toMatchObject({ count: 1, positiveCount: 1, negativeCount: 0 })
    expect(data.fsrs).toEqual({ points: [], auc: undefined })
    expect(data.rwkv).toEqual({ points: [], auc: undefined })
})
