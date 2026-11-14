import { lapseRatesByIntroduction } from "../src/ts/lapseRate"

test("groups current lapse rates by days since the latest introduction", () => {
    const cards = [
        { id: 1, lapses: 2, queue: 2 },
        { id: 2, lapses: 0, queue: 2 },
        { id: 3, lapses: 4, queue: -1 },
        { id: 4, lapses: 1, queue: 2 },
        { id: 5, lapses: 1, queue: 2 },
        { id: 6, lapses: 2, queue: 2 },
    ]
    const introduced = new Set([1, 2, 3, 4, 5])
    const introductionDays = { 1: 0, 2: 50, 3: 60, 4: 100, 5: 101, 6: 20 }

    expect(lapseRatesByIntroduction(cards, introductionDays, introduced, 100)).toEqual({
        active: { 0: 1, 2: 1 },
        all: { 0: 1, 2: 1, 10: 1 },
    })
})

test("ignores invalid lapse counts and cards awaiting reintroduction", () => {
    const cards = [
        { id: 1, lapses: -1, queue: 2 },
        { id: 2, lapses: Number.NaN, queue: 2 },
        { id: 3, lapses: 2, queue: 2 },
    ]

    expect(lapseRatesByIntroduction(cards, { 1: 1, 2: 1, 3: 1 }, new Set([1, 2]), 10)).toEqual({
        active: {},
        all: {},
    })
})
