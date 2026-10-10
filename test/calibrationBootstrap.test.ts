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

// Preserve the original implementation to verify draw and summation order.
const CALIBRATION_BOOTSTRAP_ITERATIONS = 500

const BOOTSTRAP_SEED = 0x5f3759df
const LOWER_PERCENTILE = 0.025
const UPPER_PERCENTILE = 0.975

type CalibrationBootstrapObservation = {
    cardId: number
    bin: number
    actual: number
}

type CardBinContribution = {
    bin: number
    successes: number
    count: number
}

function seededRandom(seed: number) {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let value = state
        value = Math.imul(value ^ (value >>> 15), value | 1)
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
}

function quantileSorted(values: number[], percentile: number) {
    const position = (values.length - 1) * percentile
    const lowerIndex = Math.floor(position)
    const upperIndex = Math.ceil(position)
    const weight = position - lowerIndex
    return values[lowerIndex] * (1 - weight) + values[upperIndex] * weight
}

function referenceBootstrap(
    observations: CalibrationBootstrapObservation[],
    binCount: number,
    iterations = CALIBRATION_BOOTSTRAP_ITERATIONS,
    seed = BOOTSTRAP_SEED
): Array<[number, number] | undefined> {
    const contributionsByCard = new Map<number, Map<number, CardBinContribution>>()

    for (const observation of observations) {
        let contributionsByBin = contributionsByCard.get(observation.cardId)
        if (!contributionsByBin) {
            contributionsByBin = new Map()
            contributionsByCard.set(observation.cardId, contributionsByBin)
        }

        let contribution = contributionsByBin.get(observation.bin)
        if (!contribution) {
            contribution = { bin: observation.bin, successes: 0, count: 0 }
            contributionsByBin.set(observation.bin, contribution)
        }
        contribution.successes += observation.actual
        contribution.count += 1
    }

    const cards = Array.from(contributionsByCard.values(), (contributions) =>
        Array.from(contributions.values())
    )
    const estimates = Array.from({ length: binCount }, () => <number[]>[])
    if (cards.length === 0 || iterations <= 0) {
        return Array(binCount)
    }

    const random = seededRandom(seed)
    for (let iteration = 0; iteration < iterations; iteration++) {
        const successes = new Float64Array(binCount)
        const counts = new Float64Array(binCount)

        for (let draw = 0; draw < cards.length; draw++) {
            const card = cards[Math.floor(random() * cards.length)]
            for (const contribution of card) {
                successes[contribution.bin] += contribution.successes
                counts[contribution.bin] += contribution.count
            }
        }

        for (let bin = 0; bin < binCount; bin++) {
            if (counts[bin] > 0) {
                estimates[bin].push(successes[bin] / counts[bin])
            }
        }
    }

    return estimates.map((values) => {
        if (values.length === 0) {
            return undefined
        }
        values.sort((a, b) => a - b)
        return [
            quantileSorted(values, LOWER_PERCENTILE),
            quantileSorted(values, UPPER_PERCENTILE),
        ] as [number, number]
    })
}

test("flattened card bootstrap exactly matches the original implementation", () => {
    let state = 0x12345678
    const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 4294967296
    }
    const observations = Array.from({ length: 5_000 }, (_, index) => ({
        cardId: index < 800 ? index : Math.floor(random() * 800),
        bin: Math.floor(random() * 20),
        actual: random() < 0.7 ? 1 : 0,
    }))

    expect(cardBootstrapConfidenceIntervals(observations, 20)).toEqual(
        referenceBootstrap(observations, 20)
    )
    expect(cardBootstrapConfidenceIntervals(observations, 20, 37, 0xabcdef)).toEqual(
        referenceBootstrap(observations, 20, 37, 0xabcdef)
    )
})

test("compact counters preserve exact deterministic intervals across card chunks and sparse bins", () => {
    const observations = Array.from({ length: 2400 }, (_, i) => [
        { cardId: 1730212469023 + i, bin: (i * 7) % 20, actual: i % 3 ? 1 : 0 },
        { cardId: 1730212469023 + i, bin: (i * 7 + 3) % 20, actual: 1 },
        { cardId: 1730212469023 + i, bin: (i * 7) % 20, actual: 0 },
    ]).flat()
    observations.reverse()
    expect(cardBootstrapConfidenceIntervals(observations, 20)).toEqual(
        referenceBootstrap(observations, 20)
    )
    expect(cardBootstrapConfidenceIntervals(observations, 20, 37, 123)).toEqual(
        referenceBootstrap(observations, 20, 37, 123)
    )
})
