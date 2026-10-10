import { get } from "svelte/store"
import { parseReviewRetrievabilityResponse } from "../src/ts/calibrationPredictions"
import { calibrationSamplesFrom } from "../src/ts/calibrationSamples"
import { uniqueRevlogCids } from "../src/ts/search"
import { reviewSnapshot } from "./reviewSnapshot"

test("compact presets expand to each card's complete resolved settings", async () => {
    const originalFetch = global.fetch
    // Same preset id, distinct card-specific settings must remain distinct.
    const presets = [
        { id: "shared", desiredRetention: 0.9 },
        { id: "shared", desiredRetention: 0.8 },
    ]
    jest.resetModules()
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () =>
            JSON.stringify({ presets, cards: { 1: 0, 2: 1, 3: 0 }, retrievability: { 1: 0.87 } }),
    })
    try {
        const { getFsrsPresetData } = await import("../src/ts/search")
        expect(await getFsrsPresetData([1, 2, 3])).toEqual({
            presetsByCard: { 1: presets[0], 2: presets[1], 3: presets[0] },
            retrievability: { 1: 0.87 },
        })
        expect(await getFsrsPresetData([])).toEqual({ presetsByCard: {}, retrievability: {} })
    } finally {
        global.fetch = originalFetch
        jest.resetModules()
    }
})

test("uniqueRevlogCids returns reviewed card ids once in first-seen order", () => {
    expect(
        uniqueRevlogCids([{ cid: 3 }, { cid: 1 }, { cid: 3 }, { cid: 2 }, { cid: 1 }])
    ).toStrictEqual([3, 1, 2])
})

test("getRwkvReviewRetrievability sends calibration revlog ids", async () => {
    const originalFetch = global.fetch
    const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        text: async () =>
            JSON.stringify({
                column: "cache",
                data: [[123, "0.42"]],
                roles: ["post_optimization_replay"],
                role_counts: { post_optimization_replay: 1, invalid: -1, string: "2" },
            }),
    })

    jest.resetModules()
    global.fetch = fetchMock as typeof fetch
    try {
        const { getRwkvReviewRetrievability } = await import("../src/ts/search")
        const result = await getRwkvReviewRetrievability([10, 11], 365, [123, 456, 123])

        expect(fetchMock).toHaveBeenCalledWith(
            "/_anki/rwkvReviewRetrievability",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    cids: [10, 11],
                    day_range: 365,
                    revlog_ids: [123, 456],
                }),
            })
        )
        expect(typeof result).toBe("string")
        expect(
            parseReviewRetrievabilityResponse(
                result,
                calibrationSamplesFrom([{ revlogId: 123, cardId: 10, actual: 1 }])
            )
        ).toEqual({
            column: "cache",
            responsePredictionCount: 1,
            predictions: new Float64Array([0.42]),
            warnings: [],
            roles: ["post_optimization_replay"],
            roleCounts: { post_optimization_replay: 1 },
        })
    } finally {
        global.fetch = originalFetch
        jest.resetModules()
    }
})

test("calibration stores report endpoint warnings after worker parsing", async () => {
    const originalFetch = global.fetch
    const warnMock = jest.spyOn(console, "warn").mockImplementation(() => undefined)
    const warning = "RWKV calibration ignored 2 non-answer revlog row(s)."
    const fetchMock = jest.fn(async (url: string) => ({
        ok: true,
        text: async () =>
            JSON.stringify(
                url.endsWith("ReviewRetrievability")
                    ? { column: "cache", data: [[123, 0.42]], warnings: [warning] }
                    : {
                          phase: "ready",
                          generated: false,
                          columns: [],
                          data: [],
                          presets: [],
                          cards: {},
                          retrievability: {},
                      }
            ),
    }))
    jest.resetModules()
    global.fetch = fetchMock as typeof fetch
    jest.doMock("../src/ts/statsWorkerClient", () => ({
        runStatsTask: async (task: keyof import("../src/ts/statsTasks").Tasks, args: never) => {
            const { runStatsTaskLocally } = await import("../src/ts/statsTasks")
            return runStatsTaskLocally(task, args)
        },
    }))
    try {
        const stores = await import("../src/ts/stores")
        stores.cids.set([10])
        for (let i = 0; i < 40; i++) await Promise.resolve()
        stores.memorised_stats.set({
            calibration_samples: calibrationSamplesFrom([{ revlogId: 123, cardId: 10, actual: 1 }]),
            fsrs_calibration_replay_predictions: new Float64Array([0.9]),
        } as never)
        stores.calibration_samples.set(get(stores.memorised_stats)!.calibration_samples)
        for (let i = 0; i < 40; i++) await Promise.resolve()
        expect(get(stores.rwkvCalibrationStats)).toMatchObject({
            column: "cache",
            predictions: new Float64Array([0.42]),
            warnings: [warning],
            roles: [],
            roleCounts: {},
        })
        expect(warnMock).toHaveBeenCalledWith("Search Stats Extended:", warning)
        stores.cids.set(null)
    } finally {
        global.fetch = originalFetch
        warnMock.mockRestore()
        jest.dontMock("../src/ts/statsWorkerClient")
        jest.resetModules()
    }
})

test("getFsrsReviewRetrievability sends calibration revlog ids", async () => {
    const originalFetch = global.fetch
    const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        text: async () =>
            JSON.stringify({
                column: "cache",
                data: [[321, "0.62"]],
                roles: ["post_optimization", null, 123],
            }),
    })

    jest.resetModules()
    global.fetch = fetchMock as typeof fetch
    try {
        const { getFsrsReviewRetrievability } = await import("../src/ts/search")
        const result = await getFsrsReviewRetrievability([20, 21], 365, [321, 654, 321])

        expect(fetchMock).toHaveBeenCalledWith(
            "/_anki/fsrsReviewRetrievability",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    cids: [20, 21],
                    day_range: 365,
                    revlog_ids: [321, 654],
                }),
            })
        )
        expect(typeof result).toBe("string")
        expect(
            parseReviewRetrievabilityResponse(
                result,
                calibrationSamplesFrom([{ revlogId: 321, cardId: 20, actual: 1 }])
            )
        ).toEqual({
            column: "cache",
            responsePredictionCount: 1,
            predictions: new Float64Array([0.62]),
            warnings: [],
            roles: ["post_optimization"],
            roleCounts: {},
        })
    } finally {
        global.fetch = originalFetch
        jest.resetModules()
    }
})

test("RWKV Memorised endpoints send the selected card ids", async () => {
    const originalFetch = global.fetch
    const progress = {
        phase: "computing",
        current: 10,
        total: 100,
        done: false,
    }
    const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify(progress),
    })

    jest.resetModules()
    global.fetch = fetchMock as typeof fetch
    try {
        const {
            cancelRwkvMemorisedHistory,
            getRwkvMemorisedHistoryProgress,
            startRwkvMemorisedHistory,
        } = await import("../src/ts/search")

        await expect(startRwkvMemorisedHistory([10, 11])).resolves.toEqual(progress)
        await expect(getRwkvMemorisedHistoryProgress([10, 11])).resolves.toEqual(progress)
        await cancelRwkvMemorisedHistory()

        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            "/_anki/startRwkvMemorisedHistory",
            expect.objectContaining({ body: JSON.stringify({ cids: [10, 11] }) })
        )
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            "/_anki/rwkvMemorisedHistoryProgress",
            expect.objectContaining({ body: JSON.stringify({ cids: [10, 11] }) })
        )
        expect(fetchMock).toHaveBeenNthCalledWith(
            3,
            "/_anki/cancelRwkvMemorisedHistory",
            expect.objectContaining({ body: "{}" })
        )
    } finally {
        global.fetch = originalFetch
        jest.resetModules()
    }
})

test("review history follows page cursors and maps columns without losing rows", async () => {
    const originalFetch = global.fetch
    const columns = ["cid", "id", "ease", "ivl", "lastIvl", "time", "factor", "type"]
    const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({
            ok: true,
            text: async () =>
                JSON.stringify({
                    columns,
                    data: [[10, 1700000000001, 3, -60, 2, 5000, 2500, 0]],
                    next_after_id: 1700000000001,
                }),
        })
        .mockResolvedValueOnce({
            ok: true,
            text: async () =>
                JSON.stringify({
                    columns,
                    data: [[10, 1700000000002, 0, 0, 0, 0, 0, 4]],
                    next_after_id: null,
                }),
        })
    jest.resetModules()
    global.fetch = fetchMock as typeof fetch
    try {
        const { getRevlogs } = await import("../src/ts/search")
        const history = await getRevlogs([10], 365)
        expect(history?.values.byteLength).toBe(2 * 8 * 8)
        expect(Array.from(history!, reviewSnapshot)).toEqual([
            {
                id: 1700000000001,
                cid: 10,
                ease: 3,
                ivl: -60,
                lastIvl: 2,
                time: 5000,
                factor: 2500,
                type: 0,
            },
            {
                id: 1700000000002,
                cid: 10,
                ease: 0,
                ivl: 0,
                lastIvl: 0,
                time: 0,
                factor: 0,
                type: 4,
            },
        ])
        expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body))).toEqual([
            { cids: [10], day_range: 365, after_id: 0 },
            { cids: [10], day_range: 365, after_id: 1700000000001 },
        ])
    } finally {
        global.fetch = originalFetch
        jest.resetModules()
    }
})

test("cancelled history loading stops before requesting another page", async () => {
    const originalFetch = global.fetch
    const controller = new AbortController()
    const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => {
            controller.abort()
            return JSON.stringify({ columns: [], data: [], next_after_id: 1 })
        },
    })
    jest.resetModules()
    global.fetch = fetchMock as typeof fetch
    try {
        const { getRevlogs } = await import("../src/ts/search")
        await expect(getRevlogs([10], 0, controller.signal)).rejects.toMatchObject({
            name: "AbortError",
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
        global.fetch = originalFetch
        jest.resetModules()
    }
})
