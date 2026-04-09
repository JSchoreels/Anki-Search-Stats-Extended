import { fsrs } from "ts-fsrs"
import {
    type S90BatchResolver,
    getMemorisedDays,
    s90DedupStepForStability,
} from "../src/ts/MemorisedBar"
import type { DeckConfig } from "../src/ts/config"
import { dayFromMs } from "../src/ts/revlogGraphs"
import { Revlog } from "../src/ts/search"
import { RevlogBuilder } from "./revlogBuilder"

const weights = [
    0.40255,
    1.18385,
    3.173,
    15.69105,
    7.1949,
    0.5345,
    1.4604,
    0.0046,
    1.54575,
    0.1192,
    1.01925,
    1.9395,
    0.11,
    0.29605,
    2.2698,
    0.2315,
    2.9898,
    0.51655,
    0.6621, // Defaults
]
const weights2 = [
    1,
    100,
    100,
    100,
    7.1949,
    0.5345,
    1.4604,
    0.0046,
    1.54575,
    0.1192,
    1.01925,
    1.9395,
    0.11,
    0.29605,
    2.2698,
    0.2315,
    2.9898, // on initial good: 100, no intra-day
]
const weights7 = [
    0.041, 2.4175, 4.1283, 11.9709, 5.6385, 0.4468, 3.262, 2.3054, 0.1688, 1.3325, 0.3524, 0.0049,
    0.7503, 0.0896, 0.6625, 1.3, 0.882, 0.3072, 3.5875, 0.303, 0.0107, 0.2279, 2.6413, 0.5594, 1.3,
    2.5, 1.0, 0.0723, 0.1634, 0.5, 0.9555, 0.2245, 0.6232, 0.1362, 0.3862,
]

const mappings = { 1: 1, 2: 2, 3: 3 }
const configs: Record<number, Partial<DeckConfig>> = {
    1: { id: 1, fsrsWeights: weights, fsrsParams5: weights },
    2: { id: 2, fsrsWeights: weights2, fsrsParams5: weights2 },
    3: { id: 3, fsrsParams7: weights7 },
}

function s90(fsrsInstance: ReturnType<typeof fsrs>, stability: number, target = 0.9): number {
    let low = 0
    let high = Math.max(stability, 1)
    while (fsrsInstance.forgetting_curve(high, stability) > target && high < 36500) {
        high = Math.min(high * 2, 36500)
    }
    for (let i = 0; i < 50; i++) {
        const mid = (low + high) / 2
        const r = fsrsInstance.forgetting_curve(mid, stability)
        if (r > target) {
            low = mid
        } else {
            high = mid
        }
    }
    return (low + high) / 2
}

function localS90Resolver(cards: any[]): S90BatchResolver {
    const fsrsByConfigId: Record<number, ReturnType<typeof fsrs>> = {
        1: fsrs({ w: weights }),
        2: fsrs({ w: weights2 }),
        3: fsrs({ w: weights7 }),
    }
    return async (items, target) => {
        return items.map((item) => {
            const fsrsModel = fsrsByConfigId[item.config_id]
            return s90(fsrsModel, item.stability, target)
        })
    }
}

test("Day Timings", async () => {
    const card = new RevlogBuilder()
    const cards = [
        {
            ...card.card(),
            did: 1,
        } as any,
    ]

    const revlogs = [
        card.review(-3000, 3),
        card.review(-3000, 3),
        card.review(5, 3),
        card.review(10, 3),
        card.review(20, 3),
    ] as Revlog[]

    const memorised = (
        await getMemorisedDays(revlogs, cards, configs, mappings, [], 2, 2, localS90Resolver(cards))
    ).retrievabilityDays

    expect(memorised.length).not.toBe(0)
    expect(memorised[0]).toBe(1)
    expect(memorised[5]).toBe(1)
    expect(memorised[15]).toBe(1)
    expect(memorised[16]).not.toBe(0)
})

// https://github.com/open-spaced-repetition/fsrs-rs/blob/a7aaa40498bae992e0be0a1e9a1380e4992aee60/src/inference.rs#L433-L465
test("Stability", async () => {
    const card = new RevlogBuilder()
    const FSRS = fsrs({ w: weights })
    const cards = [
        {
            ...card.card(),
            did: 1,
        } as any,
    ]

    const revlogs = [
        card.review(1, 1),
        card.review(3, 3),
        card.review(21, 3),
        card.review(80, 3),
    ] as Revlog[]

    const memorised = (
        await getMemorisedDays(revlogs, cards, configs, mappings, [], 2, 2, localS90Resolver(cards))
    ).retrievabilityDays

    const OFFSET = 10

    expect(memorised[card.last_review + OFFSET]).toBeCloseTo(
        FSRS.forgetting_curve(OFFSET, 31.722975)
    )
})

test("Stability On Forget", async () => {
    const card = new RevlogBuilder()
    const FSRS = fsrs({ w: weights })
    const cards = [
        {
            ...card.card(),
            did: 1,
        } as any,
    ]

    const revlogs = [
        card.review(1, 1),
        card.review(3, 3),
        card.review(0, 0),
        card.review(1, 1),
        card.review(3, 3),
        card.review(21, 3),
        card.review(80, 3),
    ] as Revlog[]

    const memorised = (
        await getMemorisedDays(revlogs, cards, configs, mappings, [], 2, 2, localS90Resolver(cards))
    ).retrievabilityDays

    const OFFSET = 10

    expect(memorised[card.last_review + OFFSET]).toBeCloseTo(
        FSRS.forgetting_curve(OFFSET, 31.722975)
    )
})

test("Leech Detection", async () => {
    const card = new RevlogBuilder()
    const cards = [
        {
            ...card.card(),
            did: 2,
        } as any,
    ]

    const revlogs = [card.review(-100, 3), card.review(100, 3), card.review(100, 1)] as Revlog[]

    const leech_probabilities = (
        await getMemorisedDays(revlogs, cards, configs, mappings, [], 1, 0, localS90Resolver(cards))
    ).leech_probabilities

    expect(leech_probabilities[card.card().id]).toBeCloseTo(0.1)
})

test("FSRS7 params are accepted in memorised graph pipeline", async () => {
    const card = new RevlogBuilder()
    const cards = [
        {
            ...card.card(),
            did: 3,
        } as any,
    ]
    const revlogs = [card.review(-3000, 3), card.review(-3000, 3), card.review(5, 3)] as Revlog[]

    const memorised = (
        await getMemorisedDays(revlogs, cards, configs, mappings, [], 2, 2, localS90Resolver(cards))
    ).retrievabilityDays

    expect(memorised.length).not.toBe(0)
    expect(memorised[0]).toBe(1)
})

test("Calibration uses FSRS6 equation when deck option selects FSRS6", async () => {
    const card = new RevlogBuilder()
    const cards = [
        {
            ...card.card(),
            did: 1,
        } as any,
    ]
    const revlogs = [card.review(1, 3), card.review(3, 3)] as Revlog[]
    const config = {
        1: {
            id: 1,
            fsrsVersion: 1,
            fsrsParams6: weights,
            fsrsParams7: weights7,
        },
    } as Record<number, Partial<DeckConfig>>
    const mapping = { 1: 1 }
    const resolver: S90BatchResolver = async (items) => items.map((item) => item.stability)

    const stats = await getMemorisedDays(revlogs, cards, config, mapping, [], 2, 2, resolver)
    const calibrationEntry = stats.calibration.find((entry) => !!entry && entry.count > 0)

    expect(calibrationEntry).toBeTruthy()
    expect(calibrationEntry!.count).toBe(1)

    const fsrs6 = fsrs({ w: weights })
    const fsrs7 = fsrs({ w: weights7 })
    const firstState6 = fsrs6.next_state(null, 0, 3)
    const expectedP6 = fsrs6.forgetting_curve(1, firstState6.stability)
    const firstState7 = fsrs7.next_state(null, 0, 3)
    const p7 = fsrs7.forgetting_curve(1, firstState7.stability)

    expect(calibrationEntry!.predicted).toBeCloseTo(expectedP6, 6)
    expect(Math.abs(calibrationEntry!.predicted - p7)).toBeGreaterThan(1e-4)
})

test("Calibration uses FSRS7 equation when deck option selects FSRS7", async () => {
    const card = new RevlogBuilder()
    const cards = [
        {
            ...card.card(),
            did: 1,
        } as any,
    ]
    const revlogs = [card.review(1, 3), card.review(3, 3)] as Revlog[]
    const config = {
        1: {
            id: 1,
            fsrsVersion: 0,
            fsrsParams6: weights,
            fsrsParams7: weights7,
        },
    } as Record<number, Partial<DeckConfig>>
    const mapping = { 1: 1 }
    const resolver: S90BatchResolver = async (items) => items.map((item) => item.stability)

    const stats = await getMemorisedDays(revlogs, cards, config, mapping, [], 2, 2, resolver)
    const calibrationEntry = stats.calibration.find((entry) => !!entry && entry.count > 0)

    expect(calibrationEntry).toBeTruthy()
    expect(calibrationEntry!.count).toBe(1)

    const fsrs6 = fsrs({ w: weights })
    const fsrs7 = fsrs({ w: weights7 })
    const firstState6 = fsrs6.next_state(null, 0, 3)
    const p6 = fsrs6.forgetting_curve(1, firstState6.stability)
    const firstState7 = fsrs7.next_state(null, 0, 3)
    const expectedP7 = fsrs7.forgetting_curve(1, firstState7.stability)

    expect(calibrationEntry!.predicted).toBeCloseTo(expectedP7, 6)
    expect(Math.abs(calibrationEntry!.predicted - p6)).toBeGreaterThan(1e-4)
})

test("Average stability over time uses S90 for FSRS7", async () => {
    const card = new RevlogBuilder()
    const fsrs7 = fsrs({ w: weights7 })
    const cards = [
        {
            ...card.card(),
            did: 3,
        } as any,
    ]
    const revlogs = [card.review(1, 3), card.review(3, 3)] as Revlog[]

    const stats = await getMemorisedDays(
        revlogs,
        cards,
        configs,
        mappings,
        [],
        2,
        2,
        localS90Resolver(cards)
    )

    const firstDay = dayFromMs(revlogs[0].id)
    const firstReviewState = fsrs7.next_state(null, 0, 3)
    const expectedS90 = s90(fsrs7, firstReviewState.stability)

    expect(stats.day_means[firstDay]).toBeCloseTo(expectedS90, 5)
    expect(stats.day_means[firstDay]).not.toBeCloseTo(firstReviewState.stability, 2)
    expect(stats.day_young_ratio_s90[firstDay]).toBeGreaterThanOrEqual(0)
    expect(stats.day_young_ratio_s90[firstDay]).toBeLessThanOrEqual(1)
})

test("S90 batch requests deduplicate close stabilities per config", async () => {
    const cardA = new RevlogBuilder()
    const cardB = new RevlogBuilder()
    const cards = [
        {
            ...cardA.card(),
            did: 3,
        } as any,
        {
            ...cardB.card(),
            did: 3,
        } as any,
    ]
    const revlogs = [cardA.review(1, 3), cardB.review(1, 3), cardA.review(3, 3)] as Revlog[]

    const batchSizes: number[] = []
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})
    const resolver: S90BatchResolver = async (items) => {
        batchSizes.push(items.length)
        return items.map((item) => item.stability)
    }

    await getMemorisedDays(revlogs, cards, configs, mappings, [], 2, 2, resolver)
    const dedupSummaryLogs = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith("S90 dedup summary:"))
    logSpy.mockRestore()

    expect(batchSizes.length).toBe(1)
    expect(batchSizes[0]).toBeLessThan(3)
    expect(dedupSummaryLogs.length).toBeGreaterThan(0)
    expect(dedupSummaryLogs[0]).toMatch(
        /^S90 dedup summary: \d+\/\d+ \(\d+\.\d%\), backend calls: \d+$/
    )
})

test("S90 dedup step is dynamic by stability range", () => {
    expect(s90DedupStepForStability(10)).toBe(0.1)
    expect(s90DedupStepForStability(10.01)).toBe(0.5)
    expect(s90DedupStepForStability(3.2)).toBe(0.1)
    expect(s90DedupStepForStability(25)).toBe(0.5)
})

test("S90 dedup cache avoids repeated backend calls across flushes", async () => {
    const cardA = new RevlogBuilder()
    const cardB = new RevlogBuilder()
    const cardC = new RevlogBuilder()
    cardC.wait(24 * 60 * 60 * 1000)

    const cards = [
        {
            ...cardA.card(),
            did: 3,
        } as any,
        {
            ...cardB.card(),
            did: 3,
        } as any,
        {
            ...cardC.card(),
            did: 3,
        } as any,
    ]
    const revlogs = [
        cardA.review(2, 3),
        cardB.review(2, 3),
        cardC.review(2, 3),
        cardA.review(1, 3),
    ].sort((a, b) => a.id - b.id) as Revlog[]

    const batchSizes: number[] = []
    const resolver: S90BatchResolver = async (items) => {
        batchSizes.push(items.length)
        return items.map((item) => item.stability)
    }

    await getMemorisedDays(revlogs, cards, configs, mappings, [], 2, 2, resolver)

    expect(batchSizes.length).toBe(1)
    expect(batchSizes[0]).toBeGreaterThan(0)
})
