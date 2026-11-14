import type { CardData } from "./cardData"

type LapseRateCard = Pick<CardData, "id" | "lapses" | "queue">

/** Group stored lapse counts by the elapsed days since the latest introduction. */
export function lapseRatesByIntroduction(
    cards: LapseRateCard[],
    introductionDays: Record<number, number>,
    introduced: ReadonlySet<number>,
    today: number
) {
    const active: Record<number, number> = {}
    const all: Record<number, number> = {}
    for (const card of cards) {
        const day = introductionDays[card.id]
        const elapsed = today - day
        if (
            !introduced.has(card.id) ||
            !Number.isFinite(elapsed) ||
            elapsed <= 0 ||
            !Number.isSafeInteger(card.lapses) ||
            card.lapses < 0
        ) {
            continue
        }
        const bucket = Math.floor((100 * card.lapses) / elapsed)
        if (!Number.isSafeInteger(bucket)) continue
        all[bucket] = (all[bucket] ?? 0) + 1
        if (card.queue !== -1) active[bucket] = (active[bucket] ?? 0) + 1
    }
    return { active, all }
}
