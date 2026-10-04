import type { CardData } from "./cardData"
import { dayFromMs, today } from "./revlogGraphs"

export function dueDayOffset(card: CardData, daysElapsed: number): number {
    const due = card.odue || card.due
    return due < 365_000 ? due - daysElapsed : dayFromMs(due * 1000) - today
}
