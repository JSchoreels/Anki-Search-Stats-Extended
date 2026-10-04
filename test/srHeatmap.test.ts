// Mock the stores module to prevent side effects during import
jest.mock("../src/ts/stores", () => ({
    shownCategories: {
        subscribe: jest.fn(),
    },
}))

import { CardType } from "../anki/ts/lib/tslib/cards"
import type { CardData } from "../src/ts/search"
import { calculate_sr_heatmap_data, create_card_sr_dataset } from "../src/ts/srHeatmap"

test("Normal card uses due field", () => {
    const cards: CardData[] = [
        {
            id: 1,
            nid: 1,
            did: 1,
            ord: 0,
            mod: 0,
            usn: 0,
            type: CardType.Review,
            queue: 0,
            due: 100,
            ivl: 10,
            factor: 0,
            reps: 0,
            lapses: 0,
            left: 0,
            odue: 0, // Normal card
            odid: 0,
            flags: 0,
            data: JSON.stringify({ s: 5, d: 0.3 }),
        },
    ]

    const dataset = create_card_sr_dataset(cards, 100)
    expect(dataset).not.toBeNull()
    expect(dataset!.card_sr_data.length).toBe(1)
    expect(dataset!.card_sr_data[0].s).toBe(5)
})

test("Retrievability uses internal stability when stored S90 differs", () => {
    const cards: CardData[] = [
        {
            id: 1,
            nid: 1,
            did: 1,
            ord: 0,
            mod: 0,
            usn: 0,
            type: CardType.Review,
            queue: 0,
            due: 100,
            ivl: 10,
            factor: 0,
            reps: 0,
            lapses: 0,
            left: 0,
            odue: 0,
            odid: 0,
            flags: 0,
            data: JSON.stringify({ s: 5, s_int: 20, d: 0.3 }),
        },
    ]

    const dataset = create_card_sr_dataset(cards, 100)
    expect(dataset).not.toBeNull()
    expect(dataset!.card_sr_data[0].s).toBe(5)
    expect(dataset!.card_sr_data[0].r).not.toBeCloseTo(1)
})

test("Filtered card uses odue field", () => {
    const cards: CardData[] = [
        {
            id: 1,
            nid: 1,
            did: 1,
            ord: 0,
            mod: 0,
            usn: 0,
            type: CardType.Review,
            queue: 0,
            due: 50, // Modified by filter
            ivl: 10,
            factor: 0,
            reps: 0,
            lapses: 0,
            left: 0,
            odue: 100, // Original due (filtered card)
            odid: 1,
            flags: 0,
            data: JSON.stringify({ s: 5, d: 0.3 }),
        },
    ]

    const dataset = create_card_sr_dataset(cards, 100)
    expect(dataset).not.toBeNull()
    expect(dataset!.card_sr_data.length).toBe(1)
})

test("Skips cards with invalid data", () => {
    const cards: CardData[] = [
        {
            id: 1,
            nid: 1,
            did: 1,
            ord: 0,
            mod: 0,
            usn: 0,
            type: CardType.Review,
            queue: 0,
            due: 100,
            ivl: 10,
            factor: 0,
            reps: 0,
            lapses: 0,
            left: 0,
            odue: 0,
            odid: 0,
            flags: 0,
            data: JSON.stringify({}), // No FSRS data
        },
    ]

    const dataset = create_card_sr_dataset(cards, 100)
    expect(dataset).toBeNull()
})

test.each([false, true])(
    "heatmap preserves identical boundary values (log stability: %s)",
    (log) => {
        const dataset = {
            min_r: 1,
            max_r: 1,
            min_s: 10,
            max_s: 10,
            card_sr_data: [
                { r: 1, s: 10 },
                { r: 1, s: 10 },
            ],
        }
        const heatmap = calculate_sr_heatmap_data(dataset, 0.05, log ? 0.1 : 1, log)!

        expect(heatmap.x_dim.bin_count).toBe(1)
        expect(heatmap.y_dim.bin_count).toBe(1)
        expect(heatmap.raw_data).toEqual([2])
        expect(heatmap.x_dim.end_value).toBeGreaterThan(heatmap.x_dim.start_value)
        expect(heatmap.y_dim.end_value).toBeGreaterThan(heatmap.y_dim.start_value)
    }
)
