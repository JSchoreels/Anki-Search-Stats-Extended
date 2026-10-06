import { default_w } from "ts-fsrs"
import { FSRS7_DEFAULT_WEIGHTS } from "ts-fsrs/models/fsrs-7"
import { selectCalibrationSamples } from "../src/ts/calibrationSampleSelection"
import type { CardData, Revlog } from "../src/ts/cardData"
import type { DeckConfig, ResolvedFsrsPreset } from "../src/ts/config"
import { getFsrs } from "../src/ts/fsrsModel"
import {
    applyOutlierFilter,
    buildCalibrationBinCounts,
    buildCalibrationBins,
    calibrationConfidenceIntervals,
    getMemorisedDays,
    withConfidenceIntervals,
} from "../src/ts/MemorisedBar"
import { calculateRevlogStats, lastForgetByCard } from "../src/ts/revlogGraphs"

const day = 86400000
const start = Date.UTC(2026, 8, 1, 12)
const configs = { 1: { id: 1, fsrsVersion: 1, fsrsParams6: [...default_w] } as DeckConfig }
const mapping = { 1: 1 }

test.each([1, 17, 501])("selection matches replay for seeded histories (%i)", async (seed) => {
    let state = seed
    const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 2 ** 32
    }
    const cards: CardData[] = []
    const revlogs: Revlog[] = []
    const presets: Record<number, ResolvedFsrsPreset> = {}
    for (let cid = 1; cid <= 240; cid++) {
        cards.push({
            id: cid,
            nid: cid,
            did: cid % 3 === 0 ? 99 : 1,
            odid: cid % 3 === 0 ? 1 : 0,
            type: 2,
            queue: 2,
            data: "{}",
            ivl: 3,
        } as CardData)
        if (cid % 2 === 0)
            presets[cid] = {
                id: "seven",
                name: "seven",
                fsrsVersion: "seven",
                params: [...FSRS7_DEFAULT_WEIGHTS],
                desiredRetention: 0.9,
                historicalRetention: 0.9,
                ignoreRevlogsBeforeDate: cid % 4 === 0 ? "2026-09-03" : "",
            } as ResolvedFsrsPreset
        let time = start + cid
        const add = (gap: number, ease: Revlog["ease"], type = 1, factor = 2500) => {
            time += gap
            revlogs.push({ id: time, cid, ease, type, factor, ivl: 3, lastIvl: 1, time: 1000 })
        }
        add(0, 3, 0)
        add(600000, 3, 0)
        // Most cards share one interval; a small outlier group must be excluded.
        add(cid <= 8 ? 7 * day : day, 3)
        add(1000, 0, 4, 2500) // manual entry, no reset
        add(day, 4, 3, 0) // cram
        for (let i = 0; i < 7; i++) {
            add(
                random() < 0.4 ? 600000 : (1 + Math.floor(random() * 3)) * day,
                (1 + Math.floor(random() * 4)) as Revlog["ease"],
                i === 3 ? 2 : 1
            )
        }
        if (cid % 5 === 0) {
            add(day, 0, 4, 0)
            add(1000, 3, 0)
            add(day, 1, 2)
            add(day, 3)
        }
        add(80 * day, 3) // beyond snapshot
    }
    revlogs.sort((a, b) => a.id - b.id)
    const snapshot = start + 35 * day
    const forgotten = lastForgetByCard(revlogs)
    SSEother.deck_configs = configs
    SSEother.deck_config_ids = mapping
    try {
        expect(forgotten).toEqual(
            calculateRevlogStats(revlogs, cards, undefined, presets).last_forget
        )
        const excluded = applyOutlierFilter(revlogs)
        expect(excluded.size).toBeGreaterThan(0)
        expect(excluded.has(revlogs.find((r) => r.cid === 1)!.id)).toBe(true)
        const models = new Set([getFsrs(configs[1]), ...Object.values(presets).map(getFsrs)])
        const math = [...models].flatMap((model) =>
            (["nextState", "retrievability", "interval"] as const).map((method) =>
                jest.spyOn(model, method).mockImplementation(() => {
                    throw new Error("Sample selection must not run FSRS math")
                })
            )
        )
        let selected: ReturnType<typeof selectCalibrationSamples>
        try {
            selected = selectCalibrationSamples(revlogs, cards, configs, mapping, presets, snapshot)
            math.forEach((method) => expect(method).not.toHaveBeenCalled())
        } finally {
            math.forEach((method) => method.mockRestore())
        }
        const replay = await getMemorisedDays(
            revlogs,
            cards,
            configs,
            mapping,
            forgotten,
            2,
            2,
            presets,
            undefined,
            snapshot
        )
        expect(selected).toEqual(replay.calibration_samples)
        expect(selected.revlogIds.length).toBeGreaterThan(100)
        const predictions = replay.fsrs_calibration_replay_predictions
        predictions[0] = NaN
        predictions[1] = 1.2
        const bins = buildCalibrationBinCounts(selected, predictions)
        const before = bins.map((bin) => ({ ...bin }))
        const combined = withConfidenceIntervals(
            bins,
            calibrationConfidenceIntervals(selected, predictions)
        )
        expect(combined).toEqual(buildCalibrationBins(selected, predictions))
        expect(bins).toEqual(before)
        bins.forEach((bin, i) => expect(combined[i]).not.toBe(bin))
    } finally {
        delete SSEother.deck_configs
        delete SSEother.deck_config_ids
    }
})

test("last-forget uses supplied order, including unsorted markers", () => {
    const reviews = [
        { cid: 1, id: 200, factor: 0, type: 4 },
        { cid: 1, id: 100, factor: 0, type: 4 },
    ] as Revlog[]
    expect(lastForgetByCard(reviews)[1]).toBe(100)
})
