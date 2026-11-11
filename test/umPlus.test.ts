import type { CalibrationSampleInput as CalibrationSample } from "../src/ts/calibrationSamples"
import {
    buildUmPlusData,
    umPlusDisagreementDomain,
    umPlusErrorDomain,
    visibleUmPlusBins,
    weightedRegressionSlope,
    type UmPlusBin,
} from "../src/ts/umPlusData"
import { calibrationInputs } from "./calibrationInputs"

function groupedSamples(count: number, recalled: number, firstRevlogId: number) {
    return Array.from(
        { length: count },
        (_, index): CalibrationSample => ({
            revlogId: firstRevlogId + index,
            cardId: firstRevlogId + index,
            actual: index < recalled ? 1 : 0,
        })
    )
}

test("UM+ groups paired reviews by model disagreement", () => {
    const lowerFsrs = groupedSamples(10, 5, 1)
    const higherFsrs = groupedSamples(10, 8, 11)
    const samples = [...lowerFsrs, ...higherFsrs]
    const fsrsPredictions = Object.fromEntries([
        ...lowerFsrs.map((sample) => [sample.revlogId, 0.5]),
        ...higherFsrs.map((sample) => [sample.revlogId, 0.8]),
    ])
    const rwkvPredictions = Object.fromEntries([
        ...lowerFsrs.map((sample) => [sample.revlogId, 0.7]),
        ...higherFsrs.map((sample) => [sample.revlogId, 0.6]),
    ])

    const data = buildUmPlusData(...calibrationInputs(samples, fsrsPredictions, rwkvPredictions))

    expect(data.count).toBe(20)
    expect(data.bins).toHaveLength(2)
    expect(data.bins[0]).toMatchObject({ count: 10 })
    expect(data.bins[0].disagreement).toBeCloseTo(-0.2)
    expect(data.bins[0].firstError).toBeCloseTo(0)
    expect(data.bins[0].secondError).toBeCloseTo(0.2)
    expect(data.bins[1].disagreement).toBeCloseTo(0.2)
    expect(data.bins[1].firstError).toBeCloseTo(0)
    expect(data.bins[1].secondError).toBeCloseTo(-0.2)
    expect(data.firstScore).toBeCloseTo(0)
    expect(data.secondScore).toBeCloseTo(0.2)
})

test("UM+ includes only reviews with valid paired predictions", () => {
    const data = buildUmPlusData(
        ...calibrationInputs(
            [
                { revlogId: 1, cardId: 1, actual: 1 },
                { revlogId: 2, cardId: 2, actual: 0 },
                { revlogId: 3, cardId: 3, actual: 1 },
            ],
            { 1: 0.8, 2: 0.5, 3: 1.2 },
            { 1: 0.6, 3: 0.4 }
        )
    )

    expect(data.count).toBe(1)
    expect(data.bins).toHaveLength(1)
    expect(data.bins[0].disagreement).toBeCloseTo(0.2)
    for (const item of data.disagreementPercentiles) {
        expect(item.absoluteDisagreement).toBeCloseTo(0.2)
    }
})

test("UM+ preserves model order when comparing either pair of predictions", () => {
    const samples = [{ revlogId: 1, cardId: 1, actual: 1 }]
    const [input, big, small] = calibrationInputs(samples, { 1: 0.8 }, { 1: 0.6 })
    const forward = buildUmPlusData(input, big, small)
    const reversed = buildUmPlusData(input, small, big)

    expect(forward.bins[0].disagreement).toBeCloseTo(0.2)
    expect(reversed.bins[0].disagreement).toBeCloseTo(-0.2)
    expect(forward.firstScore).toBeCloseTo(reversed.secondScore)
    expect(forward.secondScore).toBeCloseTo(reversed.firstScore)
})

test("UM+ measures absolute disagreement percentiles per review before binning", () => {
    const disagreements = [
        ...Array(680).fill(0.011),
        ...Array(270).fill(-0.019),
        ...Array(47).fill(0.4),
        ...Array(3).fill(-1),
    ]
    // Repeated reviews of one card each contribute to the review distribution.
    const samples = disagreements.map((_, i) => ({ revlogId: i + 1, cardId: 1, actual: 1 }))
    const data = buildUmPlusData(
        ...calibrationInputs(
            samples,
            Object.fromEntries(disagreements.map((value, i) => [i + 1, Math.max(0, value)])),
            Object.fromEntries(disagreements.map((value, i) => [i + 1, Math.max(0, -value)]))
        )
    )

    expect(data.count).toBe(1000)
    expect(data.disagreementPercentiles).toEqual([
        { percentile: 68, absoluteDisagreement: 0.011 },
        { percentile: 95, absoluteDisagreement: 0.019 },
        { percentile: 99.7, absoluteDisagreement: 0.4 },
    ])
    // P99.7 includes a hidden small bucket, even though the plot hides its points.
    expect(visibleUmPlusBins(data.bins, false)).toHaveLength(1)
})

test.each([
    { disagreements: [], expected: [] },
    { disagreements: [0], expected: [0, 0, 0] },
    { disagreements: [0.25, 0.25], expected: [0.25, 0.25, 0.25] },
    { disagreements: [0, 0.5, 1], expected: [1, 1, 1] },
])(
    "UM+ percentile nearest ranks handle empty, tied and small samples: $disagreements",
    ({ disagreements, expected }) => {
        const data = buildUmPlusData(
            ...calibrationInputs(
                disagreements.map((_, i) => ({ revlogId: i + 1, cardId: i + 1, actual: 1 })),
                Object.fromEntries(disagreements.map((value, i) => [i + 1, value])),
                Object.fromEntries(disagreements.map((_, i) => [i + 1, 0]))
            )
        )

        expect(data.disagreementPercentiles.map((item) => item.absoluteDisagreement)).toEqual(
            expected
        )
    }
)

test("paired UM+ bin errors differ by the bin disagreement", () => {
    const samples = groupedSamples(4, 3, 1)
    const data = buildUmPlusData(
        ...calibrationInputs(
            samples,
            { 1: 0.9, 2: 0.8, 3: 0.7, 4: 0.8 },
            { 1: 0.7, 2: 0.6, 3: 0.5, 4: 0.6 }
        )
    )

    expect(data.bins).toHaveLength(1)
    const bin = data.bins[0]
    expect(bin.firstError - bin.secondError).toBeCloseTo(bin.disagreement)
})

test("UM+ disagreement domain rounds observed values outward to 10%", () => {
    expect(
        umPlusDisagreementDomain([
            { index: 15, disagreement: -0.23, firstError: 0, secondError: 0, count: 1 },
            { index: 23, disagreement: 0.17, firstError: 0, secondError: 0, count: 1 },
        ])
    ).toEqual([-0.3, 0.2])
})

test("UM+ disagreement domain expands a single rounded value", () => {
    expect(
        umPlusDisagreementDomain([
            { index: 24, disagreement: 0.2, firstError: 0, secondError: 0, count: 1 },
        ])
    ).toEqual([0.1, 0.3])
})

test("UM+ error domain covers both models and rounds outward to 10%", () => {
    expect(
        umPlusErrorDomain([
            { index: 16, disagreement: -0.2, firstError: -0.12, secondError: 0.08, count: 200 },
            { index: 24, disagreement: 0.2, firstError: 0.16, secondError: -0.04, count: 200 },
        ])
    ).toEqual([-0.2, 0.2])
})

test("UM+ error domain keeps zero inside the plot when errors share a sign", () => {
    expect(
        umPlusErrorDomain([
            { index: 20, disagreement: 0, firstError: 0.04, secondError: 0.16, count: 200 },
        ])
    ).toEqual([-0.1, 0.2])
})

function volumeBin(index: number, count: number): UmPlusBin {
    return { index, disagreement: (index - 20) / 20, firstError: 0, secondError: 0, count }
}

test("UM+ hides buckets with fewer than 200 reviews by default", () => {
    const bins = [volumeBin(1, 199), volumeBin(20, 200), volumeBin(39, 201)]

    expect(visibleUmPlusBins(bins, false)).toEqual([volumeBin(20, 200), volumeBin(39, 201)])
})

test("UM+ can show buckets with fewer than 200 reviews", () => {
    const bins = [volumeBin(1, 199), volumeBin(20, 200), volumeBin(39, 201)]

    expect(visibleUmPlusBins(bins, true)).toEqual(bins)
})

test("UM+ calculates review-weighted regression slopes from visible buckets", () => {
    const bins = [
        {
            ...volumeBin(16, 200),
            disagreement: -0.2,
            firstError: -0.05,
            secondError: 0.15,
        },
        {
            ...volumeBin(20, 400),
            disagreement: 0,
            firstError: 0,
            secondError: 0,
        },
        {
            ...volumeBin(24, 200),
            disagreement: 0.2,
            firstError: 0.05,
            secondError: -0.15,
        },
    ]

    expect(weightedRegressionSlope(bins, (bin) => bin.firstError)).toBeCloseTo(0.25)
    expect(weightedRegressionSlope(bins, (bin) => bin.secondError)).toBeCloseTo(-0.75)
})

test("UM+ regression slope is unavailable without disagreement variation", () => {
    expect(weightedRegressionSlope([volumeBin(20, 200)], (bin) => bin.firstError)).toBeUndefined()
})
