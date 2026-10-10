export const CALIBRATION_BOOTSTRAP_ITERATIONS = 500

const BOOTSTRAP_SEED = 0x5f3759df
const LOWER_PERCENTILE = 0.025
const UPPER_PERCENTILE = 0.975

export type CalibrationBootstrapObservation = {
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

export function cardBootstrapConfidenceIntervals(
    observations: Iterable<CalibrationBootstrapObservation>,
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

    const cardCount = contributionsByCard.size
    const estimates = Array.from({ length: binCount }, () => <number[]>[])
    if (cardCount === 0 || iterations <= 0) {
        return Array(binCount)
    }

    let total = 0
    for (const contributions of contributionsByCard.values()) {
        total += contributions.size
    }
    const offsets = new Uint32Array(cardCount + 1)
    const bins = new Uint16Array(total)
    const successes = new Float64Array(total)
    const counts = new Float64Array(total)
    let cardIndex = 0
    let index = 0
    for (const contributions of contributionsByCard.values()) {
        offsets[cardIndex++] = index
        for (const contribution of contributions.values()) {
            bins[index] = contribution.bin
            successes[index] = contribution.successes
            counts[index] = contribution.count
            index += 1
        }
    }
    offsets[cardCount] = index

    const random = seededRandom(seed)
    const iterationSuccesses = new Float64Array(binCount)
    const iterationCounts = new Float64Array(binCount)
    for (let iteration = 0; iteration < iterations; iteration++) {
        iterationSuccesses.fill(0)
        iterationCounts.fill(0)

        for (let draw = 0; draw < cardCount; draw++) {
            const card = Math.floor(random() * cardCount)
            for (let index = offsets[card]; index < offsets[card + 1]; index++) {
                iterationSuccesses[bins[index]] += successes[index]
                iterationCounts[bins[index]] += counts[index]
            }
        }

        for (let bin = 0; bin < binCount; bin++) {
            if (iterationCounts[bin] > 0) {
                estimates[bin].push(iterationSuccesses[bin] / iterationCounts[bin])
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
