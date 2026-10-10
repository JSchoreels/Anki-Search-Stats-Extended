export const CALIBRATION_BOOTSTRAP_ITERATIONS = 500

const BOOTSTRAP_SEED = 0x5f3759df
const LOWER_PERCENTILE = 0.025
const UPPER_PERCENTILE = 0.975

export type CalibrationBootstrapObservation = {
    cardId: number
    bin: number
    actual: number
}

const CARD_CHUNK_SIZE = 1024

// Dense counters for the small fixed bin set avoid a Map and contribution
// object per card/bin. This frame releases counters/maps before resampling.
function collectContributions(
    observations: Iterable<CalibrationBootstrapObservation>,
    binCount: number
) {
    const cards = new Map<number, number>()
    const chunks: { successes: Float64Array; counts: Float64Array }[] = []
    let total = 0
    for (const observation of observations) {
        let card = cards.get(observation.cardId)
        if (card === undefined) {
            card = cards.size
            cards.set(observation.cardId, card)
            if (card % CARD_CHUNK_SIZE === 0)
                chunks.push({
                    successes: new Float64Array(CARD_CHUNK_SIZE * binCount),
                    counts: new Float64Array(CARD_CHUNK_SIZE * binCount),
                })
        }
        // Out-of-range bins contribute no displayed estimate, but the card
        // still belongs to the resampling population.
        if (
            !Number.isInteger(observation.bin) ||
            observation.bin < 0 ||
            observation.bin >= binCount
        )
            continue
        const chunk = chunks[Math.floor(card / CARD_CHUNK_SIZE)]
        const index = (card % CARD_CHUNK_SIZE) * binCount + observation.bin
        if (chunk.counts[index] === 0) total++
        chunk.successes[index] += observation.actual
        chunk.counts[index]++
    }
    const cardCount = cards.size
    const offsets = new Uint32Array(cardCount + 1)
    const bins = new Uint16Array(total)
    const successes = new Float64Array(total)
    const counts = new Float64Array(total)
    let index = 0
    for (let card = 0; card < cardCount; card++) {
        offsets[card] = index
        const chunk = chunks[Math.floor(card / CARD_CHUNK_SIZE)]
        const start = (card % CARD_CHUNK_SIZE) * binCount
        for (let bin = 0; bin < binCount; bin++) {
            if (!chunk.counts[start + bin]) continue
            bins[index] = bin
            successes[index] = chunk.successes[start + bin]
            counts[index++] = chunk.counts[start + bin]
        }
    }
    offsets[cardCount] = index
    return { cardCount, offsets, bins, successes, counts }
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
    const { cardCount, offsets, bins, successes, counts } = collectContributions(
        observations,
        binCount
    )
    const estimates = Array.from({ length: binCount }, () => <number[]>[])
    if (cardCount === 0 || iterations <= 0) return Array(binCount)

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
