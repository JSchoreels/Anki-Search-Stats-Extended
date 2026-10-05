import { buildRocData, ROC_POINT_RESOLUTION } from "../src/ts/rocData"
import { calibrationInputs } from "./calibrationInputs"

test("ROC compares FSRS and RWKV on the same paired reviews", () => {
    const data = buildRocData(
        ...calibrationInputs(
            [
                { revlogId: 1, cardId: 1, actual: 1 },
                { revlogId: 2, cardId: 2, actual: 1 },
                { revlogId: 3, cardId: 3, actual: 0 },
                { revlogId: 4, cardId: 4, actual: 0 },
            ],
            { 1: 0.9, 2: 0.8, 3: 0.2, 4: 0.1 },
            { 1: 0.1, 2: 0.2, 3: 0.8, 4: 0.9 }
        )
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
        ...calibrationInputs(
            [
                { revlogId: 1, cardId: 1, actual: 1 },
                { revlogId: 2, cardId: 2, actual: 0 },
            ],
            { 1: 0.5, 2: 0.5 },
            { 1: 0.5, 2: 0.5 }
        )
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
        ...calibrationInputs(
            [
                { revlogId: 1, cardId: 1, actual: 1 },
                { revlogId: 2, cardId: 2, actual: 0 },
                { revlogId: 3, cardId: 3, actual: 0 },
                { revlogId: 4, cardId: 4, actual: 2 },
            ],
            { 1: 0.8, 2: 0.2, 3: 1.1, 4: 0.4 },
            { 1: 0.7, 2: 0.3, 3: 0.2, 4: 0.5 }
        )
    )

    expect(data).toMatchObject({ count: 2, positiveCount: 1, negativeCount: 1 })
    expect(data.fsrs.auc).toBeCloseTo(1)
})

test("ROC AUC is unavailable when the paired sample has only one outcome class", () => {
    const data = buildRocData(
        ...calibrationInputs([{ revlogId: 1, cardId: 1, actual: 1 }], { 1: 0.8 }, { 1: 0.7 })
    )

    expect(data).toMatchObject({ count: 1, positiveCount: 1, negativeCount: 0 })
    expect(data.fsrs).toEqual({ points: [], auc: undefined })
    expect(data.rwkv).toEqual({ points: [], auc: undefined })
})

test("large ROC curves are downsampled without changing full-curve AUC", () => {
    let state = 0x12345678
    const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 4294967296
    }
    const fsrs: Record<number, number> = {}
    const rwkv: Record<number, number> = {}
    const samples = Array.from({ length: 100_000 }, (_, revlogId) => {
        fsrs[revlogId] = random()
        rwkv[revlogId] = random()
        return { revlogId, cardId: revlogId, actual: random() < 0.7 ? 1 : 0 }
    })
    const data = buildRocData(...calibrationInputs(samples, fsrs, rwkv))
    const referenceAuc = (predictions: Record<number, number>) => {
        const sorted = [...samples].sort(
            (left, right) => predictions[right.revlogId] - predictions[left.revlogId]
        )
        const points = [{ falsePositiveRate: 0, truePositiveRate: 0 }]
        let positives = 0
        let negatives = 0
        for (let start = 0; start < sorted.length; ) {
            let end = start
            while (
                end < sorted.length &&
                predictions[sorted[end].revlogId] === predictions[sorted[start].revlogId]
            ) {
                if (sorted[end].actual === 1) positives++
                else negatives++
                end++
            }
            points.push({
                falsePositiveRate: negatives / data.negativeCount,
                truePositiveRate: positives / data.positiveCount,
            })
            start = end
        }
        return points.slice(1).reduce((area, point, index) => {
            const previous = points[index]
            return (
                area +
                ((point.falsePositiveRate - previous.falsePositiveRate) *
                    (point.truePositiveRate + previous.truePositiveRate)) /
                    2
            )
        }, 0)
    }

    expect(ROC_POINT_RESOLUTION).toBe(1 / 1000)
    expect(data.count).toBe(samples.length)
    expect(data.positiveCount).toBe(samples.filter((sample) => sample.actual === 1).length)
    expect(data.negativeCount).toBe(samples.filter((sample) => sample.actual === 0).length)
    for (const [series, predictions] of [
        [data.fsrs, fsrs],
        [data.rwkv, rwkv],
    ] as const) {
        expect(series.points.length).toBeLessThanOrEqual(2_003)
        expect(series.points[0]).toMatchObject({ falsePositiveRate: 0, truePositiveRate: 0 })
        expect(series.points.at(-1)).toMatchObject({ falsePositiveRate: 1, truePositiveRate: 1 })
        expect(series.auc).toBeCloseTo(referenceAuc(predictions), 12)
    }
})
