import type { CardData } from "./cardData"

type LoadCard = Pick<CardData, "reps" | "lapses" | "ivl" | "queue">
type LoadBucket = { sum: number; count: number }

export function cardMetricBuckets(
    cards: LoadCard[],
    metric: "reps" | "lapses",
    includeSuspended: boolean,
    valueKind: "load" | "repetitions" | "repetitionsPerLapse" = "load"
) {
    const buckets: (LoadBucket | undefined)[] = []
    for (const card of cards) {
        const value = card[metric]
        if (
            !Number.isSafeInteger(card.reps) ||
            card.reps <= 0 ||
            (!includeSuspended && card.queue === -1) ||
            !Number.isSafeInteger(value) ||
            value < 0
        ) {
            continue
        }
        const bucket = (buckets[value] ??= { sum: 0, count: 0 })
        bucket.sum +=
            valueKind === "load"
                ? card.ivl > 0
                    ? 1 / card.ivl
                    : 1
                : valueKind === "repetitions"
                  ? card.reps
                  : card.reps / (card.lapses + 1)
        bucket.count++
    }
    return buckets
}

export function averageForRange(buckets: (LoadBucket | undefined)[], start: number, width: number) {
    let sum = 0
    let count = 0
    for (const bucket of buckets.slice(start, start + width)) {
        if (bucket) {
            sum += bucket.sum
            count += bucket.count
        }
    }
    return count ? sum / count : 0
}
