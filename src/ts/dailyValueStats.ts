import type { DailyTransitions } from "./dailyTransitions"

/** Exact per-day means and medians, with logarithmic updates per changed card. */
export function dailyValueStats(events: DailyTransitions, days: number[], lastDay: number) {
    const values = new Set<number>()
    for (const day of days) {
        for (const [, value] of events.entries(day)) {
            if (value !== null && Number.isFinite(value)) values.add(value)
        }
    }
    const sorted = Array.from(values).sort((a, b) => a - b)
    const indexes = new Map(sorted.map((value, index) => [value, index]))
    const tree = new Float64Array(sorted.length + 1)
    const current = new Map<number, number>()
    const means: number[] = []
    const medians: number[] = []
    let sum = 0

    function update(value: number, delta: number) {
        let index = indexes.get(value)! + 1
        while (index < tree.length) {
            tree[index] += delta
            index += index & -index
        }
        sum += value * delta
    }

    function atRank(rank: number) {
        let index = 0
        let step = 1
        while (step * 2 < tree.length) step *= 2
        while (step > 0) {
            const next = index + step
            if (next < tree.length && tree[next] <= rank) {
                index = next
                rank -= tree[next]
            }
            step = Math.floor(step / 2)
        }
        return sorted[index]
    }

    days.forEach((day, index) => {
        for (const [cardId, value] of events.entries(day)) {
            const previous = current.get(cardId)
            if (previous !== undefined) update(previous, -1)
            if (value === null || !Number.isFinite(value)) current.delete(cardId)
            else {
                current.set(cardId, value)
                update(value, 1)
            }
        }
        if (!current.size) return
        const low = Math.floor((current.size - 1) / 2)
        const high = Math.floor(current.size / 2)
        const median = (atRank(low) + atRank(high)) / 2
        const mean = sum / current.size
        const next = days[index + 1] ?? lastDay + 1
        for (let fillDay = day; fillDay < next; fillDay++) {
            means[fillDay] = mean
            medians[fillDay] = median
        }
    })
    return { means, medians }
}
