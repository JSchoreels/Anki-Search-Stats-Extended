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
    expect(data.fsrs).toEqual({ points: [], auc: undefined, interval: undefined })
    expect(data.rwkv).toEqual({ points: [], auc: undefined, interval: undefined })
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
    expect(ROC_POINT_RESOLUTION).toBe(1 / 1000)
    expect(data.count).toBe(samples.length)
    expect(data.positiveCount).toBe(samples.filter((sample) => sample.actual === 1).length)
    expect(data.negativeCount).toBe(samples.filter((sample) => sample.actual === 0).length)
    for (const series of [data.fsrs, data.rwkv]) {
        expect(series.points.length).toBeLessThanOrEqual(2_003)
        expect(series.points[0]).toMatchObject({ falsePositiveRate: 0, truePositiveRate: 0 })
        expect(series.points.at(-1)).toMatchObject({ falsePositiveRate: 1, truePositiveRate: 1 })
    }
})

// Independent Mann–Whitney placements: no sorting or threshold sweep.
function pairwisePlacements(actual: Uint8Array, scores: Float64Array) {
    const positives = Array.from(actual.keys()).filter((i) => actual[i] === 1)
    const negatives = Array.from(actual.keys()).filter((i) => actual[i] === 0)
    const placements = new Float64Array(actual.length)
    let wins = 0
    for (const positive of positives) {
        for (const negative of negatives) {
            const credit =
                scores[positive] > scores[negative]
                    ? 1
                    : scores[positive] === scores[negative]
                      ? 0.5
                      : 0
            placements[positive] += credit / negatives.length
            placements[negative] += credit / positives.length
            wins += credit
        }
    }
    return { placements, auc: wins / (positives.length * negatives.length) }
}

function randomInputs(count: number, cards: number) {
    let state = 0x12345678
    const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 4294967296
    }
    const fsrs: Record<number, number> = {}
    const rwkv: Record<number, number> = {}
    const samples = Array.from({ length: count }, (_, revlogId) => {
        fsrs[revlogId] = Math.round(random() * 100) / 100
        rwkv[revlogId] = Math.round(random() * 100) / 100
        return { revlogId, cardId: revlogId % cards, actual: random() < 0.7 ? 1 : 0 }
    })
    return calibrationInputs(samples, fsrs, rwkv)
}

const z = 1.959963984540054
const referenceInterval = (value: number, variance: number, minimum = 0) => ({
    lower: Math.max(minimum, value - z * Math.sqrt(Math.max(0, variance))),
    upper: Math.min(1, value + z * Math.sqrt(Math.max(0, variance))),
})

function expectInterval(
    actual: { lower: number; upper: number } | undefined,
    expected: { lower: number; upper: number }
) {
    expect(actual).toBeDefined()
    expect(Math.abs(actual!.lower - expected.lower)).toBeLessThanOrEqual(1e-12)
    expect(Math.abs(actual!.upper - expected.upper)).toBeLessThanOrEqual(1e-12)
}

test("AUC matches an independent pairwise Mann–Whitney count with ties", () => {
    const inputs = randomInputs(3_000, 600)
    const data = buildRocData(...inputs)
    for (const [series, predictions] of [
        [data.fsrs, inputs[1]],
        [data.rwkv, inputs[2]],
    ] as const) {
        const reference = pairwisePlacements(inputs[0].actual, predictions)
        expect(Math.abs(series.auc! - reference.auc)).toBeLessThanOrEqual(1e-12)
        const positivePlacements = reference.placements.filter((_, i) => inputs[0].actual[i] === 1)
        const mean = positivePlacements.reduce((sum, value) => sum + value, 0) / data.positiveCount
        expect(Math.abs(series.auc! - mean)).toBeLessThanOrEqual(1e-12)
    }
})

test("card-clustered DeLong intervals match a brute-force Obuchowski reference", () => {
    const inputs = randomInputs(400, 60)
    const [samples, fsrs, rwkv] = inputs
    const data = buildRocData(...inputs)
    const models = [
        pairwisePlacements(samples.actual, fsrs),
        pairwisePlacements(samples.actual, rwkv),
    ]
    const cards = [...new Set(samples.cardIds)]
    const clusters = cards.map((card) => {
        const indices = Array.from(samples.cardIds.keys()).filter(
            (i) => samples.cardIds[i] === card
        )
        const positive = indices.filter((i) => samples.actual[i] === 1)
        const negative = indices.filter((i) => samples.actual[i] === 0)
        return {
            m: positive.length,
            n: negative.length,
            x: models.map((model) => positive.reduce((sum, i) => sum + model.placements[i], 0)),
            y: models.map((model) => negative.reduce((sum, i) => sum + model.placements[i], 0)),
        }
    })
    const M = data.positiveCount
    const N = data.negativeCount
    const I = clusters.length
    const I10 = clusters.filter((cluster) => cluster.m > 0).length
    const I01 = clusters.filter((cluster) => cluster.n > 0).length
    const S10 = (k: number, l: number) =>
        (I10 / ((I10 - 1) * M)) *
        clusters.reduce(
            (sum, c) => sum + (c.x[k] - c.m * models[k].auc) * (c.x[l] - c.m * models[l].auc),
            0
        )
    const S01 = (k: number, l: number) =>
        (I01 / ((I01 - 1) * N)) *
        clusters.reduce(
            (sum, c) => sum + (c.y[k] - c.n * models[k].auc) * (c.y[l] - c.n * models[l].auc),
            0
        )
    const S11 = (k: number, l: number) =>
        (I / (I - 1)) *
        clusters.reduce(
            (sum, c) => sum + (c.x[k] - c.m * models[k].auc) * (c.y[l] - c.n * models[l].auc),
            0
        )
    const cov = (k: number, l: number) =>
        S10(k, l) / M + S01(k, l) / N + (S11(k, l) + S11(l, k)) / (M * N)
    expectInterval(data.fsrs.interval, referenceInterval(models[0].auc, cov(0, 0)))
    expectInterval(data.rwkv.interval, referenceInterval(models[1].auc, cov(1, 1)))
    const difference = models[0].auc - models[1].auc
    expect(Math.abs(data.difference!.value - difference)).toBeLessThanOrEqual(1e-12)
    expectInterval(
        data.difference?.interval,
        referenceInterval(difference, cov(0, 0) + cov(1, 1) - 2 * cov(0, 1), -1)
    )
})

test("one review per card matches classic unclustered DeLong variance", () => {
    const inputs = randomInputs(400, 400)
    const data = buildRocData(...inputs)
    const sampleVariance = (values: Float64Array) => {
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length
        return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
    }
    for (const [series, scores] of [
        [data.fsrs, inputs[1]],
        [data.rwkv, inputs[2]],
    ] as const) {
        const reference = pairwisePlacements(inputs[0].actual, scores)
        const positive = reference.placements.filter((_, i) => inputs[0].actual[i] === 1)
        const negative = reference.placements.filter((_, i) => inputs[0].actual[i] === 0)
        const variance =
            sampleVariance(positive) / positive.length + sampleVariance(negative) / negative.length
        expectInterval(series.interval, referenceInterval(reference.auc, variance))
        const computedVariance = ((series.interval!.upper - series.auc!) / z) ** 2
        expect(Math.abs(computedVariance - variance)).toBeLessThanOrEqual(1e-12)
    }
})

test("duplicated reviews on the same card have wider intervals than independent copies", () => {
    const [samples, fsrs, rwkv] = randomInputs(200, 200)
    const duplicateScores = (scores: Float64Array) => Float64Array.from([...scores, ...scores])
    const duplicated = {
        revlogIds: Float64Array.from({ length: 400 }, (_, i) => i),
        cardIds: Float64Array.from([...samples.cardIds, ...samples.cardIds]),
        actual: Uint8Array.from([...samples.actual, ...samples.actual]),
    }
    const clustered = buildRocData(duplicated, duplicateScores(fsrs), duplicateScores(rwkv))
    const independent = buildRocData(
        { ...duplicated, cardIds: Float64Array.from({ length: 400 }, (_, i) => i) },
        duplicateScores(fsrs),
        duplicateScores(rwkv)
    )
    for (const model of ["fsrs", "rwkv"] as const) {
        expect(clustered[model].auc).toBe(independent[model].auc)
        const width = (interval: { lower: number; upper: number } | undefined) =>
            interval!.upper - interval!.lower
        expect(width(clustered[model].interval)).toBeGreaterThan(width(independent[model].interval))
    }
})

test.each([0, 1])("intervals are unavailable with only one cluster for class %i", (singleClass) => {
    const inputs = calibrationInputs(
        [
            { revlogId: 1, cardId: 1, actual: singleClass },
            { revlogId: 2, cardId: 1, actual: singleClass },
            { revlogId: 3, cardId: 2, actual: 1 - singleClass },
            { revlogId: 4, cardId: 3, actual: 1 - singleClass },
        ],
        { 1: 0.8, 2: 0.2, 3: 0.5, 4: 0.6 },
        { 1: 0.6, 2: 0.5, 3: 0.2, 4: 0.8 }
    )
    const data = buildRocData(...inputs)
    expect(data.fsrs.auc).toBeDefined()
    expect(data.rwkv.auc).toBeDefined()
    expect(data.fsrs.points.length).toBeGreaterThan(0)
    expect(data.fsrs.interval).toBeUndefined()
    expect(data.rwkv.interval).toBeUndefined()
    expect(data.difference).toBeUndefined()
})

test("repeated reviews allocate confidence accumulators per card instead of per review", () => {
    const count = 40000
    const samples = {
        revlogIds: Float64Array.from({ length: count }, (_, i) => i + 1),
        cardIds: Float64Array.from({ length: count }, (_, i) => (i % 2) + 1),
        actual: Uint8Array.from({ length: count }, (_, i) => (i % 4 < 2 ? 1 : 0)),
    }
    const predictions = Float64Array.from(samples.actual, (actual) => (actual ? 0.9 : 0.1))
    const original = global.Float64Array
    const allocations: number[] = []
    global.Float64Array = new Proxy(original, {
        construct(target, args, newTarget) {
            if (typeof args[0] === "number") allocations.push(args[0])
            return Reflect.construct(target, args, newTarget)
        },
    })
    try {
        const result = buildRocData(samples, predictions, predictions)
        expect(result.fsrs.auc).toBe(1)
        expect(result.difference?.value).toBe(0)
        expect(allocations.filter((size) => size === count)).toHaveLength(5)
        expect(allocations.filter((size) => size === 2)).toHaveLength(6)
    } finally {
        global.Float64Array = original
    }
})
