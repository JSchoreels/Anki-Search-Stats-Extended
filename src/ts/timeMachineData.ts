import type { BarDatum } from "./bar"

export function buildTimeMachineCardData(
    intervals: number[][],
    addedCards: Record<number, number>,
    today: number
): BarDatum[] {
    const runningAdded: Record<number, number> = {}
    let total = 0
    const firstAdded = Math.min(0, ...Object.keys(addedCards).map(Number))
    for (let day = firstAdded; day <= 0; day++) {
        total += addedCards[day] ?? 0
        runningAdded[day] = total
    }

    return Array.from(intervals).map((counts, day) => {
        const intraDay = counts?.[0] ?? 0
        const learning = counts?.[-2] ?? 0
        const relearning = intraDay - learning
        const young = (counts ?? []).slice(1, 21).reduce((sum, count) => sum + count, 0)
        const mature = (counts ?? []).slice(21).reduce((sum, count) => sum + count, 0)
        const suspended = counts?.[-1] ?? 0
        const newCards = (runningAdded[day - today] ?? 0) - intraDay - young - mature - suspended
        return {
            label: (day - today).toString(),
            values: [mature, young, learning, relearning, suspended, newCards],
        }
    })
}
