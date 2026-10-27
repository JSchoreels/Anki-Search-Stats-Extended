import { ankiDaySnapshotMs } from "../src/ts/ankiDay"
import { alignPredictions, calibrationSamplesFrom } from "../src/ts/calibrationSamples"
import type { DeckConfig, ResolvedFsrsPreset } from "../src/ts/config"
import { getFsrsForParams, type FsrsModel } from "../src/ts/fsrsModel"
import { selectResolvedFsrsPresetParams, selectTsFsrsParams } from "../src/ts/fsrsParams"
import {
    buildCalibrationBins,
    getMemorisedDays,
    intervalAtRetrievability,
    type S90BatchResolver,
} from "../src/ts/MemorisedBar"
import { day_ms, dayFromMs, today } from "../src/ts/revlogGraphs"
import { Revlog } from "../src/ts/search"
import { calibrationInputs } from "./calibrationInputs"
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
    0.1104, 2.2395, 3.9221, 11.7841, 6.1686, 0.6457, 3.6807, 1.9795, 0.0, 1.3826, 0.7024, 0.5999,
    0.8146, 0.6398, 1.0, 1.3207, 0.6707, 3.8668, 0.4416, 0.0934, 1.8631, 0.6162, 1.0869, 0.1567,
    0.0801, 0.2421, 0.9464, 0.1433, 0.7145, 0.0, 0.5667, 0.3734, 0.5333, 0.3048,
]
const legacyPreviewWeights7 = [
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

function localS90Resolver(
    cards: any[],
    deckConfigs: Record<number, Partial<DeckConfig>>,
    configMapping: Record<number, number>,
    fsrsPresetsByCard: Record<number, ResolvedFsrsPreset> = {}
): S90BatchResolver {
    const cardsById = Object.fromEntries(cards.map((card) => [card.id, card]))
    const fsrsBySignature: Record<string, FsrsModel> = {}

    function paramsForCard(cardId: number) {
        const preset = fsrsPresetsByCard[cardId]
        if (preset) {
            return selectResolvedFsrsPresetParams(preset)
        }
        const card = cardsById[cardId]
        const config = deckConfigs[configMapping[card.odid || card.did]]
        return selectTsFsrsParams(config as DeckConfig)
    }

    return async (items, target) =>
        items.map((item) => {
            const params = paramsForCard(item.card_id)
            const signature = `${params.length}:${params.join(",")}`
            fsrsBySignature[signature] ??= getFsrsForParams(params)
            return intervalAtRetrievability(fsrsBySignature[signature], item, target)
        })
}

function getMemorisedDaysForTest(
    revlogs: Revlog[],
    cards: any[],
    deckConfigs: Record<number, Partial<DeckConfig>>,
    configMapping: Record<number, number>,
    lastForget: number[] = [],
    leechElapsedThreshold = 2,
    leechMinReviews = 2,
    fsrsPresetsByCard: Record<number, ResolvedFsrsPreset> = {}
) {
    return getMemorisedDays(
        revlogs,
        cards,
        deckConfigs as typeof SSEother.deck_configs,
        configMapping,
        lastForget,
        leechElapsedThreshold,
        leechMinReviews,
        fsrsPresetsByCard,
        localS90Resolver(cards, deckConfigs, configMapping, fsrsPresetsByCard)
    )
}

function resolvedPreset(
    params: number[],
    id = "addon:test",
    fsrsVersion: ResolvedFsrsPreset["fsrsVersion"] = "seven"
): ResolvedFsrsPreset {
    return {
        id,
        name: id,
        fsrsVersion,
        params,
        desiredRetention: 0.9,
        historicalRetention: 0.9,
        ignoreRevlogsBeforeDate: "",
        fsrsDynamicDesiredRetentionEnabled: false,
        fsrsDynamicDesiredRetentionParams: [],
        fsrsDynamicDesiredRetentionWeights: [],
        fsrsDynamicDesiredRetentionAvgDrs: [],
        fsrsDynamicDesiredRetentionFsrsEqWeights: [],
        fsrsDynamicDesiredRetentionFsrsEqDrs: [],
        fsrsDynamicDesiredRetentionMin: 0,
        fsrsDynamicDesiredRetentionMax: 0,
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

    const memorised = (await getMemorisedDaysForTest(revlogs, cards, configs, mappings, [], 2, 2))
        .retrievabilityDays

    expect(memorised.length).not.toBe(0)
    expect(memorised[0]).toBe(1)
    expect(memorised[5]).toBe(1)
    expect(memorised[15]).toBe(1)
    expect(memorised[16]).not.toBe(0)
})

test("review counts include every answer and exclude manual reset markers", async () => {
    const card = new RevlogBuilder()
    const first = card.review(-3000, 3) as Revlog
    const second = card.review(1, 3) as Revlog
    const reset = card.review(0, 0) as Revlog
    const afterReset = card.review(-3000, 1) as Revlog
    const cram = { ...afterReset, id: afterReset.id + 1, ease: 2, type: 3 } as Revlog
    const stats = await getMemorisedDaysForTest(
        [first, second, reset, afterReset, cram],
        [{ ...card.card(), did: 1 } as any],
        configs,
        mappings
    )

    expect(stats.reviewCountsByDay[dayFromMs(first.id)]).toBe(2)
    expect(stats.reviewCountsByDay[dayFromMs(reset.id)]).toBe(2)
})

test("review recall gain compares each answer with the same card immediately before it", async () => {
    const card = new RevlogBuilder()
    const first = card.review(10, 3) as Revlog
    const second = card.review(10, 3) as Revlog
    const repetition = { ...second, id: second.id + 1_000 } as Revlog
    const filtered = { ...second, id: second.id + 2_000, factor: 0, type: 3 } as Revlog
    const stats = await getMemorisedDaysForTest(
        [first, second, repetition, filtered],
        [{ ...card.card(), did: 1 } as any],
        configs,
        mappings
    )
    const model = getFsrsForParams(weights)
    const initial = model.nextState(null, 0, first.ease)
    const firstDay = dayFromMs(first.id)
    const secondDay = dayFromMs(second.id)

    expect(stats.reviewRecallGainByDay[firstDay]).toBeCloseTo(1)
    expect(stats.reviewRecallGainCountsByDay[firstDay]).toBe(1)
    expect(stats.reviewRecallGainByDay[secondDay]).toBeCloseTo(
        1 - model.retrievability(initial, secondDay - firstDay)
    )
    // The same-day repetition has zero modeled FSRS-6 gain; cram has no replay state.
    expect(stats.reviewRecallGainCountsByDay[secondDay]).toBe(2)
    expect(stats.reviewCountsByDay[secondDay]).toBe(3)
    expect(stats.reviewRecallGainByDay[firstDay + 1]).toBeUndefined()
})

test("review recall gain skips the first retained answer when its prior state is unknown", async () => {
    const card = new RevlogBuilder()
    const first = { ...card.review(10, 3), type: 1, factor: 2500 } as Revlog
    const second = card.review(10, 3) as Revlog
    const stats = await getMemorisedDaysForTest(
        [first, second],
        [{ ...card.card(), did: 1 } as any],
        configs,
        mappings
    )

    expect(stats.reviewRecallGainCountsByDay[dayFromMs(first.id)]).toBeUndefined()
    expect(stats.reviewRecallGainCountsByDay[dayFromMs(second.id)]).toBe(1)
    expect(stats.reviewRecallGainByDay[dayFromMs(second.id)]).toBeGreaterThan(0)
})

// https://github.com/open-spaced-repetition/fsrs-rs/blob/a7aaa40498bae992e0be0a1e9a1380e4992aee60/src/inference.rs#L433-L465
test("Stability", async () => {
    const card = new RevlogBuilder()
    const FSRS = getFsrsForParams(weights)
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

    const memorised = (await getMemorisedDaysForTest(revlogs, cards, configs, mappings, [], 2, 2))
        .retrievabilityDays

    const OFFSET = 10

    expect(memorised[card.last_review + OFFSET]).toBeCloseTo(
        FSRS.retrievability({ stability: 31.722975, difficulty: 5 }, OFFSET)
    )
})

test("Stability On Forget", async () => {
    const card = new RevlogBuilder()
    const FSRS = getFsrsForParams(weights)
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

    const memorised = (await getMemorisedDaysForTest(revlogs, cards, configs, mappings, [], 2, 2))
        .retrievabilityDays

    const OFFSET = 10

    expect(memorised[card.last_review + OFFSET]).toBeCloseTo(
        FSRS.retrievability({ stability: 31.722975, difficulty: 5 }, OFFSET)
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
        await getMemorisedDaysForTest(revlogs, cards, configs, mappings, [], 1, 0)
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

    const memorised = (await getMemorisedDaysForTest(revlogs, cards, configs, mappings, [], 2, 2))
        .retrievabilityDays

    expect(memorised.length).not.toBe(0)
    const fsrs = getFsrsForParams(weights7)
    let state = fsrs.nextState(null, 0, 3)
    for (let i = 1; i < revlogs.length; i++)
        state = fsrs.nextState(state, (revlogs[i].id - revlogs[i - 1].id) / day_ms, revlogs[i].ease)
    const elapsed = (ankiDaySnapshotMs(0, 0, Date.now()) - revlogs[revlogs.length - 1].id) / day_ms
    expect(memorised[0]).toBeCloseTo(fsrs.retrievability(state, elapsed), 8)
})

test("Legacy preview FSRS7 params are accepted in memorised graph pipeline", async () => {
    const card = new RevlogBuilder()
    const cards = [
        {
            ...card.card(),
            did: 4,
        } as any,
    ]
    const legacyConfigs = {
        ...configs,
        4: { id: 4, fsrsParams7: legacyPreviewWeights7 },
    }
    const revlogs = [card.review(-3000, 3), card.review(-3000, 3), card.review(5, 3)] as Revlog[]

    const memorised = (
        await getMemorisedDaysForTest(
            revlogs,
            cards,
            legacyConfigs,
            { ...mappings, 4: 4 },
            [],
            2,
            2
        )
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

    const stats = await getMemorisedDaysForTest(revlogs, cards, config, mapping, [], 2, 2)
    const calibrationEntry = stats.calibration.find((entry) => !!entry && entry.count > 0)

    expect(calibrationEntry).toBeTruthy()
    expect(calibrationEntry!.count).toBe(1)

    const fsrs6 = getFsrsForParams(weights)
    const fsrs7 = getFsrsForParams(weights7)
    const firstState6 = fsrs6.nextState(null, 0, 3)
    const expectedP6 = fsrs6.retrievability(firstState6, 1)
    const firstState7 = fsrs7.nextState(null, 0, 3)
    const p7 = fsrs7.retrievability(firstState7, 1)

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

    const stats = await getMemorisedDaysForTest(revlogs, cards, config, mapping, [], 2, 2)
    const calibrationEntry = stats.calibration.find((entry) => !!entry && entry.count > 0)

    expect(calibrationEntry).toBeTruthy()
    expect(calibrationEntry!.count).toBe(1)

    const fsrs6 = getFsrsForParams(weights)
    const fsrs7 = getFsrsForParams(weights7)
    const firstState6 = fsrs6.nextState(null, 0, 3)
    const p6 = fsrs6.retrievability(firstState6, 1)
    const firstState7 = fsrs7.nextState(null, 0, 3)
    const expectedP7 = fsrs7.retrievability(firstState7, 1)

    expect(calibrationEntry!.predicted).toBeCloseTo(expectedP7, 6)
    expect(Math.abs(calibrationEntry!.predicted - p6)).toBeGreaterThan(1e-4)
})

test("Calibration samples can be reused with alternate review-time predictions", async () => {
    const card = new RevlogBuilder()
    const cards = [
        {
            ...card.card(),
            did: 1,
        } as any,
    ]
    const revlogs = [card.review(1, 3), card.review(3, 3)] as Revlog[]
    const stats = await getMemorisedDaysForTest(revlogs, cards, configs, mappings, [], 2, 2)
    const rwkvPrediction = 0.42
    const rwkvBins = buildCalibrationBins(
        stats.calibration_samples,
        alignPredictions(stats.calibration_samples, {
            [revlogs[1].id]: rwkvPrediction,
        })
    )
    const rwkvEntry = rwkvBins.find((entry) => !!entry && entry.count > 0)

    expect(stats.calibration_samples).toEqual(
        calibrationSamplesFrom([{ revlogId: revlogs[1].id, cardId: revlogs[1].cid, actual: 1 }])
    )
    expect(
        stats.fsrs_calibration_replay_predictions[
            stats.calibration_samples.revlogIds.indexOf(revlogs[1].id)
        ]
    ).toBeGreaterThan(0)
    expect(rwkvEntry).toBeTruthy()
    expect(rwkvEntry!.count).toBe(1)
    expect(rwkvEntry!.predicted).toBeCloseTo(rwkvPrediction, 6)
    expect(rwkvEntry!.real).toBe(1)
})

test("Alternate calibration bins ignore missing and invalid predictions", () => {
    const bins = buildCalibrationBins(
        ...calibrationInputs(
            [
                { revlogId: 1, cardId: 1, actual: 1 },
                { revlogId: 2, cardId: 2, actual: 0 },
                { revlogId: 3, cardId: 3, actual: 1 },
            ],
            {
                1: 0.25,
                2: 1.5,
            }
        )
    )
    const entries = bins.filter((entry) => !!entry && entry.count > 0)

    expect(entries).toHaveLength(1)
    expect(entries[0].count).toBe(1)
    expect(entries[0].predicted).toBeCloseTo(0.25, 6)
    expect(entries[0].real).toBe(1)
})

test("Calibration uses each card's deck preset when a parent deck is selected", async () => {
    const childA = new RevlogBuilder()
    const childB = new RevlogBuilder()
    const cards = [
        {
            ...childA.card(),
            did: 11,
        },
        {
            ...childB.card(),
            did: 12,
        },
    ] as any[]
    const revlogs = [
        childA.review(1, 3),
        childB.review(1, 3),
        childA.review(1, 3),
        childB.review(1, 3),
    ] as Revlog[]
    const config = {
        10: {
            id: 10,
            fsrsVersion: 0,
            fsrsParams7: weights7,
            fsrsParams6: [],
            fsrsParams5: [],
            fsrsParams4: [],
            fsrsWeights: [],
        },
        11: {
            id: 11,
            fsrsVersion: 1,
            fsrsParams7: [],
            fsrsParams6: weights,
            fsrsParams5: [],
            fsrsParams4: [],
            fsrsWeights: [],
        },
        12: {
            id: 12,
            fsrsVersion: 2,
            fsrsParams7: [],
            fsrsParams6: [],
            fsrsParams5: weights2,
            fsrsParams4: [],
            fsrsWeights: [],
        },
    } as Record<number, Partial<DeckConfig>>
    const mapping = { 10: 10, 11: 11, 12: 12 }

    const stats = await getMemorisedDaysForTest(revlogs, cards, config, mapping, [], 2, 2)
    const calibrationEntries = stats.calibration.filter((entry) => !!entry && entry.count > 0)
    const predicted = calibrationEntries.reduce((sum, entry) => sum + entry.predicted, 0)
    const count = calibrationEntries.reduce((sum, entry) => sum + entry.count, 0)

    const fsrsChildA = getFsrsForParams(weights)
    const fsrsChildB = getFsrsForParams(weights2)
    const fsrsParent = getFsrsForParams(weights7)
    const childAState = fsrsChildA.nextState(null, 0, 3)
    const childBState = fsrsChildB.nextState(null, 0, 3)
    const parentState = fsrsParent.nextState(null, 0, 3)
    const expectedPerCardPreset =
        fsrsChildA.retrievability(childAState, 1) + fsrsChildB.retrievability(childBState, 1)
    const parentPresetForBothCards = 2 * fsrsParent.retrievability(parentState, 1)

    expect(count).toBe(2)
    expect(predicted).toBeCloseTo(expectedPerCardPreset, 6)
    expect(Math.abs(predicted - parentPresetForBothCards)).toBeGreaterThan(1e-4)
})

test("Calibration uses Anki-resolved dynamic preset for a card", async () => {
    const card = new RevlogBuilder()
    const cards = [
        {
            ...card.card(),
            did: 3,
        } as any,
    ]
    const revlogs = [card.review(1, 3), card.review(3, 3)] as Revlog[]
    const dynamicPreset = resolvedPreset(weights, "addon:test:dynamic", "six")
    const stats = await getMemorisedDaysForTest(revlogs, cards, configs, mappings, [], 2, 2, {
        [card.card().id]: dynamicPreset,
    })
    const calibrationEntry = stats.calibration.find((entry) => !!entry && entry.count > 0)

    const deckFsrs = getFsrsForParams(weights7)
    const dynamicFsrs = getFsrsForParams(weights)
    const deckState = deckFsrs.nextState(null, 0, 3)
    const dynamicState = dynamicFsrs.nextState(null, 0, 3)

    expect(calibrationEntry).toBeTruthy()
    expect(calibrationEntry!.count).toBe(1)
    expect(calibrationEntry!.predicted).toBeCloseTo(dynamicFsrs.retrievability(dynamicState, 1), 6)
    expect(calibrationEntry!.predicted).not.toBeCloseTo(deckFsrs.retrievability(deckState, 1), 4)
})

test("Average stability over time uses replayed S90 for FSRS7", async () => {
    const card = new RevlogBuilder()
    const fsrs7 = getFsrsForParams(weights7)
    const cards = [
        {
            ...card.card(),
            did: 3,
        } as any,
    ]
    const revlogs = [card.review(1, 3), card.review(3, 3)] as Revlog[]

    const stats = await getMemorisedDaysForTest(revlogs, cards, configs, mappings, [], 2, 2)

    const firstDay = dayFromMs(revlogs[0].id)
    const firstReviewState = fsrs7.nextState(null, 0, 3)
    const expectedS90 = intervalAtRetrievability(fsrs7, firstReviewState, 0.9)

    expect(stats.day_means[firstDay]).toBeCloseTo(expectedS90, 5)
    expect(stats.day_means[firstDay]).not.toBeCloseTo(firstReviewState.stability, 2)
    expect(stats.day_young_ratio_s90[firstDay]).toBeGreaterThanOrEqual(0)
    expect(stats.day_young_ratio_s90[firstDay]).toBeLessThanOrEqual(1)
})

test("Average stability over time resolves S90 locally by default", async () => {
    const card = new RevlogBuilder()
    const cards = [
        {
            ...card.card(),
            did: 3,
        } as any,
    ]
    const revlogs = [card.review(1, 3), card.review(3, 3)] as Revlog[]
    const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(() => {
        throw new Error("S90 backend should not be called")
    })

    try {
        const stats = await getMemorisedDays(
            revlogs,
            cards,
            configs as typeof SSEother.deck_configs,
            mappings,
            [],
            2,
            2
        )
        const firstDay = dayFromMs(revlogs[0].id)
        const fsrs7 = getFsrsForParams(weights7)
        const firstReviewState = fsrs7.nextState(null, 0, 3)

        expect(stats.day_means[firstDay]).toBeCloseTo(
            intervalAtRetrievability(fsrs7, firstReviewState, 0.9),
            5
        )
        expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
        fetchSpy.mockRestore()
    }
})

test("Average stability by reps uses stored current S90 and interval", async () => {
    const cards = [
        {
            id: 1,
            nid: 1,
            did: 1,
            ivl: 20,
            reps: 2,
            data: JSON.stringify({ s: 10 }),
        },
        {
            id: 2,
            nid: 2,
            did: 1,
            ivl: 30,
            reps: 2,
            data: JSON.stringify({ s: 14 }),
        },
        {
            id: 3,
            nid: 3,
            did: 1,
            ivl: 50,
            reps: 5,
            data: JSON.stringify({ s: 21 }),
        },
        {
            id: 4,
            nid: 4,
            did: 1,
            ivl: 70,
            reps: 5,
            data: "{}",
        },
    ] as any[]

    const stats = await getMemorisedDaysForTest([], cards, configs, mappings, [], 2, 2)

    expect(stats.average_stability_by_reps[2]).toBeCloseTo(12)
    expect(stats.average_stability_by_reps[5]).toBeCloseTo(21)
    expect(stats.average_stability_by_reps[4]).toBeUndefined()
    expect(stats.average_interval_by_reps[2]).toBeCloseTo(25)
    expect(stats.average_interval_by_reps[5]).toBeCloseTo(60)
    expect(stats.average_interval_by_reps[4]).toBeUndefined()
})

test("Stability mismatch warning logs a bounded sample", async () => {
    const builders = Array.from({ length: 25 }, () => new RevlogBuilder())
    const cards = builders.map(
        (builder) =>
            ({
                ...builder.card(),
                did: 3,
                data: JSON.stringify({ s_int: 999 }),
            }) as any
    )
    const revlogs = builders.map((builder) => builder.review(1, 3)) as Revlog[]
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})

    await getMemorisedDaysForTest(revlogs, cards, configs, mappings, [], 2, 2)

    const warning = warnSpy.mock.calls.find((call) =>
        String(call[0]).startsWith("The stability of ")
    )
    warnSpy.mockRestore()

    expect(warning).toBeDefined()
    expect(warning![1].inaccurate_cids).toHaveLength(20)
    expect(warning![1].omitted_inaccurate_cids).toBe(5)
})

test("Time distribution by difficulty is generated", async () => {
    const card = new RevlogBuilder()
    const cards = [
        {
            ...card.card(),
            did: 1,
        } as any,
    ]

    const revlogs = [
        card.review(0, 3, 1000),
        card.review(1, 3, 2000),
        card.wait(2 * 24 * 60 * 60 * 1000),
        card.review(2, 3, 4000),
        card.wait(2 * 24 * 60 * 60 * 1000),
        card.review(3, 2, 6000),
    ].filter(Boolean) as Revlog[]

    const stats = await getMemorisedDaysForTest(revlogs, cards, configs, mappings, [], 2, 2)

    const difficultyValues = (stats.time_by_difficulty_mean ?? []).filter((v) => Number.isFinite(v))
    const difficultyBuckets = Object.keys(stats.time_by_difficulty_mean ?? {}).map((v) => +v)

    expect(difficultyValues.length).toBeGreaterThan(0)
    expect(Math.max(...difficultyValues)).toBeGreaterThan(0)
    expect(Math.max(...difficultyBuckets)).toBeGreaterThan(10)
})

test("Time distribution by retrievability supports same-day and success filters", async () => {
    const cid = 99999
    const card = {
        id: cid,
        nid: cid,
        did: 1,
        odid: 0,
        queue: 2,
        type: 2,
        ivl: 1,
        data: "{}",
    } as any
    const revlogs: Revlog[] = [
        {
            id: 1,
            cid,
            ease: 3,
            ivl: 1,
            lastIvl: 0,
            factor: 200,
            time: 1000,
            type: 1,
        },
        {
            id: 2,
            cid,
            ease: 1,
            ivl: 1,
            lastIvl: 1,
            factor: 200,
            time: 1000,
            type: 1,
        },
        {
            id: 3,
            cid,
            ease: 2,
            ivl: 1,
            lastIvl: 1,
            factor: 200,
            time: 2000,
            type: 1,
        },
        {
            id: 24 * 60 * 60 * 1000 + 10,
            cid,
            ease: 3,
            ivl: 2,
            lastIvl: 1,
            factor: 200,
            time: 4000,
            type: 1,
        },
    ]

    const stats = await getMemorisedDaysForTest(revlogs, [card], configs, { 1: 1 }, [], 2, 2)

    expect(stats.time_by_retrievability_mean[99]).toBeCloseTo(1.5, 5)
    expect(stats.time_by_retrievability_mean_success_only[99]).toBeCloseTo(2, 5)
    expect(stats.time_by_retrievability_mean_exclude_same_day[99]).toBeUndefined()
    expect(stats.time_by_retrievability_mean_success_only_exclude_same_day[99]).toBeUndefined()
})

test("historical stability includes the latest review day and days through today", async () => {
    const builder = new RevlogBuilder()
    builder.state.id = Date.now() - 2 * day_ms
    const review = builder.review(1, 3) as Revlog
    const stats = await getMemorisedDays(
        [review],
        [builder.card()] as any,
        configs as typeof SSEother.deck_configs,
        mappings,
        [],
        2,
        2,
        {},
        async (items) => items.map(() => 12)
    )
    for (let day = dayFromMs(review.id); day <= today; day++) {
        expect(stats.day_means[day]).toBe(12)
        expect(stats.day_medians[day]).toBe(12)
        expect(stats.day_young_ratio_s90[day]).toBe(1)
    }
})
