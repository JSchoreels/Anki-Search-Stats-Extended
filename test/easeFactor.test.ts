import { default_w } from "ts-fsrs"
import type { DeckConfig } from "../src/ts/config"
import { calculateEaseFactors } from "../src/ts/easeFactor"
import type { CardData } from "../src/ts/search"

function deckConfig(): DeckConfig {
    return {
        id: 1,
        fsrsVersion: 1,
        fsrsParams7: [],
        fsrsParams6: [...default_w],
        fsrsParams5: [],
        fsrsParams4: [],
        fsrsWeights: [],
    } as DeckConfig
}

function cardWithFsrsData(data: Record<string, number>): CardData {
    return {
        id: 1,
        did: 1,
        odid: 0,
        data: JSON.stringify(data),
    } as CardData
}

test("ease factors accept Anki FSRS stability below ts-fsrs S_MIN", () => {
    const easeFactors = calculateEaseFactors(
        [cardWithFsrsData({ d: 9.811, s: 0.0007, dr: 0.9 })],
        { 1: deckConfig() },
        { 1: 1 }
    )

    expect(easeFactors).toHaveLength(1)
    expect(Number.isFinite(easeFactors[0])).toBe(true)
})

test("ease factors skip stability below Anki FSRS minimum", () => {
    const easeFactors = calculateEaseFactors(
        [cardWithFsrsData({ d: 9.811, s: 0.00001, dr: 0.9 })],
        { 1: deckConfig() },
        { 1: 1 }
    )

    expect(easeFactors).toStrictEqual([])
})
