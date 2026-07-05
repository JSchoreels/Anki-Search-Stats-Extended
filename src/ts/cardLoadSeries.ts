import { getFsrsS90FromCard, type CardData } from "./search"

export const CARD_LOAD_PERCENTILE_BUCKET_SIZE = 5
export const YOUNG_STABILITY_THRESHOLD = 21

export type CardLoadMetric = "reps" | "lapses"
export type CardLoadInput = Pick<CardData, "data" | "ivl" | "lapses" | "queue" | "reps">
export type CardLoadSearchInput = CardLoadInput & Pick<CardData, "id">
export type CardLoadFilter = {
    onlyYoung?: boolean
}

function isYoungCard(card: CardLoadInput) {
    const stability = getFsrsS90FromCard(card as CardData)
    return stability !== undefined && stability < YOUNG_STABILITY_THRESHOLD
}

function cardContributesCurrentLoad(card: CardLoadInput, filter: CardLoadFilter = {}) {
    return card.reps > 0 && card.queue !== -1 && (!filter.onlyYoung || isYoungCard(card))
}

function percentileBucket(index: number, cardCount: number, bucketSize: number) {
    const bucketCount = Math.ceil(100 / bucketSize)
    const percentile = (index / cardCount) * 100
    return Math.min(Math.floor(percentile / bucketSize), bucketCount - 1)
}

export function currentCardLoad(card: Pick<CardLoadInput, "ivl">) {
    return card.ivl > 0 ? 1 / card.ivl : 1
}

function sortedLoadCards<T extends CardLoadInput>(
    cards: T[],
    metric: CardLoadMetric,
    filter: CardLoadFilter = {}
) {
    return cards
        .filter((card) => cardContributesCurrentLoad(card, filter))
        .map((card, originalIndex) => ({ card, originalIndex }))
        .sort((a, b) => {
            const metricComparison = a.card[metric] - b.card[metric]
            if (metricComparison !== 0) {
                return metricComparison
            }

            const loadComparison = currentCardLoad(a.card) - currentCardLoad(b.card)
            if (loadComparison !== 0) {
                return loadComparison
            }

            return a.originalIndex - b.originalIndex
        })
        .map(({ card }) => card)
}

export function loadByCardMetric(
    cards: CardLoadInput[],
    metric: CardLoadMetric,
    filter: CardLoadFilter = {}
) {
    const loads: number[] = []

    for (const card of cards) {
        if (!cardContributesCurrentLoad(card, filter)) {
            continue
        }

        const metricValue = card[metric]
        loads[metricValue] = (loads[metricValue] ?? 0) + currentCardLoad(card)
    }

    return loads
}

export function loadByCardMetricPercentile(
    cards: CardLoadInput[],
    metric: CardLoadMetric,
    bucketSize = CARD_LOAD_PERCENTILE_BUCKET_SIZE,
    filter: CardLoadFilter = {}
) {
    const loadCards = sortedLoadCards(cards, metric, filter)

    if (!loadCards.length) {
        return []
    }

    const bucketCount = Math.ceil(100 / bucketSize)
    const loads = Array<number>(bucketCount).fill(0)

    loadCards.forEach((card, index) => {
        const bucket = percentileBucket(index, loadCards.length, bucketSize)
        loads[bucket] += currentCardLoad(card)
    })

    return loads
}

export function cardIdsByCardMetricPercentile(
    cards: CardLoadSearchInput[],
    metric: CardLoadMetric,
    bucketStart: number,
    bucketWidth: number,
    cumulative = false,
    bucketSize = CARD_LOAD_PERCENTILE_BUCKET_SIZE,
    filter: CardLoadFilter = {}
) {
    const loadCards = sortedLoadCards(cards, metric, filter)

    const start = cumulative ? 0 : bucketStart
    const end = bucketStart + bucketWidth

    return loadCards
        .filter((_, index) => {
            const bucket = percentileBucket(index, loadCards.length, bucketSize)
            return bucket >= start && bucket < end
        })
        .map((card) => card.id)
}

export function cardIdsByCardMetric(
    cards: CardLoadSearchInput[],
    metric: CardLoadMetric,
    metricStart: number,
    metricWidth: number,
    cumulative = false,
    filter: CardLoadFilter = {}
) {
    const start = cumulative ? 0 : metricStart
    const end = metricStart + metricWidth

    return cards
        .filter((card) => cardContributesCurrentLoad(card, filter))
        .filter((card) => card[metric] >= start && card[metric] < end)
        .map((card) => card.id)
}
