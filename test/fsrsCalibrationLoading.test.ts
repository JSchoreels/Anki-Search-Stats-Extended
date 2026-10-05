import { get } from "svelte/store"
import { calibrationSamplesFrom, countPredictions } from "../src/ts/calibrationSamples"

const flush = async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve()
}
const response = (value: unknown) => ({ ok: true, text: async () => JSON.stringify(value) })

beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
})
afterEach(() => {
    jest.useRealTimers()
    jest.dontMock("../src/ts/statsWorkerClient")
    jest.resetModules()
})

test("Statistics reads both caches immediately while automatic generation refreshes them once", async () => {
    const originalFetch = global.fetch
    const requests: string[] = []
    let alignmentBody: unknown
    let generated = false
    const ids = [Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 2), Date.UTC(2026, 9, 3)]
    global.fetch = jest.fn(async (url: string, options) => {
        requests.push(url)
        if (url.endsWith("startFsrsCalibration"))
            return response({ phase: "queued", coversRequest: true, warnings: [] })
        if (url.endsWith("fsrsCalibrationProgress")) {
            generated = true
            return response({ phase: "ready", generated: true, warnings: [] })
        }
        if (url.endsWith("fsrsReviewRetrievability"))
            return response({
                column: "cache",
                roles: ["validation_fold"],
                data: (generated ? ids : ids.slice(-1)).map((id) => [id, 0.9]),
            })
        if (url.endsWith("rwkvReviewRetrievability")) {
            alignmentBody = JSON.parse(options!.body as string)
            return response({ column: "rwkv-cache", data: ids.map((id) => [id, 0.8]) })
        }
        if (url.endsWith("cardData")) return response({ columns: [], data: [] })
        if (url.endsWith("fsrsPresetData"))
            return response({ presets: [], cards: {}, retrievability: {} })
        return response({})
    }) as typeof fetch
    jest.doMock("../src/ts/statsWorkerClient", () => ({
        runStatsTask: async (task: keyof import("../src/ts/statsTasks").Tasks, args: never) => {
            const { runStatsTaskLocally } = await import("../src/ts/statsTasks")
            return runStatsTaskLocally(task, args)
        },
    }))
    try {
        const stores = await import("../src/ts/stores")
        stores.cids.set([10])
        await flush()
        stores.memorised_stats.set({
            calibration_samples: calibrationSamplesFrom(
                ids.map((revlogId) => ({ cardId: 10, revlogId, actual: 1 }))
            ),
            fsrs_calibration_replay_predictions: new Float64Array(ids.map(() => 0.85)),
        } as never)
        await flush()
        expect(get(stores.fsrsCalibrationStats)?.cachedPredictionCount).toBe(1)
        expect(get(stores.rwkvCalibrationStats)).not.toBeNull()
        expect(get(stores.fsrsCalibrationGeneration)?.phase).toBe("queued")
        expect(requests.filter((url) => url.endsWith("startFsrsCalibration"))).toHaveLength(1)
        expect(alignmentBody).toHaveProperty("ensure_fsrs_alignment", true)
        await jest.advanceTimersByTimeAsync(1000)
        await flush()
        const fsrs = get(stores.fsrsCalibrationStats)!
        expect(fsrs.cachedPredictionCount).toBe(3)
        expect(fsrs.roles).toEqual(["validation_fold"])
        expect(fsrs.bins.reduce((sum, bin) => sum + (bin?.count ?? 0), 0)).toBe(3)
        expect(countPredictions(get(stores.rwkvCalibrationStats)!.predictions)).toBe(3)
        expect(alignmentBody).toMatchObject({ ensure_fsrs_alignment: true, revlog_ids: ids })
        stores.memorised_stats.set({ ...get(stores.memorised_stats)! })
        await flush()
        expect(requests.filter((url) => url.endsWith("startFsrsCalibration"))).toHaveLength(1)
        stores.cids.set(null)
    } finally {
        global.fetch = originalFetch
    }
})

test("an obsolete search stops polling without publishing later progress", async () => {
    const originalFetch = global.fetch
    const controller = new AbortController()
    const progress = jest.fn()
    const fetchMock = jest.fn(async () =>
        response({ phase: "running", coversRequest: true, warnings: [] })
    )
    global.fetch = fetchMock as typeof fetch
    try {
        const { ensureFsrsCalibration } = await import("../src/ts/search")
        const pending = ensureFsrsCalibration([10], controller.signal, progress)
        await flush()
        controller.abort()
        await expect(pending).rejects.toMatchObject({ name: "AbortError" })
        await jest.advanceTimersByTimeAsync(2000)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(progress).toHaveBeenCalledTimes(1)
    } finally {
        global.fetch = originalFetch
    }
})

test("RWKV cache loads even when the FSRS cache request remains pending", async () => {
    const originalFetch = global.fetch
    global.fetch = jest.fn(async (url: string) => {
        if (url.endsWith("startFsrsCalibration"))
            return response({ phase: "running", coversRequest: true, warnings: [] })
        if (url.endsWith("fsrsReviewRetrievability")) return new Promise(() => {})
        if (url.endsWith("rwkvReviewRetrievability")) return response({ data: [[100, 0.8]] })
        return response({ columns: [], data: [], presets: [], cards: {}, retrievability: {} })
    }) as typeof fetch
    jest.doMock("../src/ts/statsWorkerClient", () => ({
        runStatsTask: async (task: keyof import("../src/ts/statsTasks").Tasks, args: never) => {
            const { runStatsTaskLocally } = await import("../src/ts/statsTasks")
            return runStatsTaskLocally(task, args)
        },
    }))
    try {
        const stores = await import("../src/ts/stores")
        stores.cids.set([10])
        await flush()
        stores.memorised_stats.set({
            calibration_samples: calibrationSamplesFrom([{ cardId: 10, revlogId: 100, actual: 1 }]),
            fsrs_calibration_replay_predictions: new Float64Array([0.9]),
        } as never)
        await flush()
        expect(get(stores.fsrsCalibrationStats)).toBeNull()
        expect(get(stores.calibrationComparison)).toBeNull()
        expect(get(stores.rwkvCalibrationStats)?.predictions).toEqual(new Float64Array([0.8]))
        expect(get(stores.fsrsCalibrationGeneration)?.phase).toBe("running")
        stores.cids.set(null)
    } finally {
        global.fetch = originalFetch
    }
})

test.each([
    { rows: [], cached: 0, prediction: 0.9, count: 1 },
    { rows: [[999, 0.8]], cached: 1, prediction: NaN, count: 0 },
    { rows: [[100, 1.2]], cached: 1, prediction: 1.2, count: 0 },
])(
    "FSRS fallback uses the response-wide validated count: $rows",
    async ({ rows, cached, prediction, count }) => {
        const originalFetch = global.fetch
        global.fetch = jest.fn(async (url: string) => {
            if (url.endsWith("startFsrsCalibration"))
                return response({ phase: "ready", generated: false, warnings: [] })
            if (url.endsWith("fsrsReviewRetrievability")) return response({ data: rows })
            if (url.endsWith("rwkvReviewRetrievability")) return response({ data: [[100, 0.8]] })
            return response({ columns: [], data: [], presets: [], cards: {}, retrievability: {} })
        }) as typeof fetch
        jest.doMock("../src/ts/statsWorkerClient", () => ({
            runStatsTask: async (task: keyof import("../src/ts/statsTasks").Tasks, args: never) => {
                const { runStatsTaskLocally } = await import("../src/ts/statsTasks")
                return runStatsTaskLocally(task, args)
            },
        }))
        try {
            const stores = await import("../src/ts/stores")
            stores.cids.set([10])
            await flush()
            stores.memorised_stats.set({
                calibration_samples: calibrationSamplesFrom([
                    { revlogId: 100, cardId: 10, actual: 1 },
                ]),
                fsrs_calibration_replay_predictions: new Float64Array([0.9]),
            } as never)
            await flush()
            const fsrs = get(stores.fsrsCalibrationStats)!
            expect(fsrs.cachedPredictionCount).toBe(cached)
            expect(fsrs.predictions).toEqual(new Float64Array([prediction]))
            expect(fsrs.bins.reduce((sum, bin) => sum + (bin?.count ?? 0), 0)).toBe(count)
            expect(get(stores.calibrationComparison)?.umPlus.count).toBe(count)
            // Daily RWKV eligibility remains independent of paired FSRS eligibility.
            expect(get(stores.calibrationComparison)?.rwkvDaily[0].count).toBe(1)
            stores.cids.set(null)
        } finally {
            global.fetch = originalFetch
        }
    }
)

test("comparison remains null until all inputs load and discards obsolete worker results", async () => {
    const pending: { signal: AbortSignal; finish: () => void }[] = []
    jest.doMock("../src/ts/statsWorkerClient", () => ({
        runStatsTask: async (
            task: keyof import("../src/ts/statsTasks").Tasks,
            args: never,
            signal: AbortSignal
        ) => {
            const { runStatsTaskLocally } = await import("../src/ts/statsTasks")
            const result = runStatsTaskLocally(task, args)
            return new Promise((resolve) => pending.push({ signal, finish: () => resolve(result) }))
        },
    }))
    const stores = await import("../src/ts/stores")
    stores.memorised_stats.set({
        calibration_samples: calibrationSamplesFrom([{ revlogId: 100, cardId: 10, actual: 1 }]),
        fsrs_calibration_replay_predictions: new Float64Array([0.9]),
    } as never)
    const fsrs = {
        column: null,
        cachedPredictionCount: 1,
        roles: [],
        warnings: [],
        bins: [],
        predictions: new Float64Array([0.9]),
    }
    stores.fsrsCalibrationStats.set(fsrs)
    await flush()
    expect(get(stores.calibrationComparison)).toBeNull()
    expect(pending).toHaveLength(0)
    stores.rwkvCalibrationStats.set({
        column: null,
        warnings: [],
        bins: [],
        predictions: new Float64Array([0.8]),
    })
    await flush()
    expect(get(stores.calibrationComparison)).toBeNull()
    expect(pending).toHaveLength(1)
    stores.fsrsCalibrationStats.set({ ...fsrs, predictions: new Float64Array([0.6]) })
    await flush()
    expect(pending[0].signal.aborted).toBe(true)
    expect(pending).toHaveLength(2)
    pending[1].finish()
    await flush()
    const current = get(stores.calibrationComparison)!
    expect(current.umPlus.bins[0].disagreement).toBeCloseTo(-0.2)
    pending[0].finish()
    await flush()
    expect(get(stores.calibrationComparison)).toBe(current)
    stores.memorised_stats.set(null)
    expect(get(stores.calibrationComparison)).toBeNull()
})

test("a concurrent request for different presets prepares its own scope after shared work", async () => {
    const originalFetch = global.fetch
    const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(response({ phase: "running", coversRequest: false, warnings: [] }))
        .mockResolvedValueOnce(response({ phase: "ready", warnings: [] }))
        .mockResolvedValueOnce(response({ phase: "ready", coversRequest: true, warnings: [] }))
    global.fetch = fetchMock as typeof fetch
    try {
        const { ensureFsrsCalibration } = await import("../src/ts/search")
        const pending = ensureFsrsCalibration([20], new AbortController().signal, () => {})
        await flush()
        await jest.advanceTimersByTimeAsync(1000)
        await expect(pending).resolves.toEqual([])
        expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
            "/_anki/startFsrsCalibration",
            "/_anki/fsrsCalibrationProgress",
            "/_anki/startFsrsCalibration",
        ])
    } finally {
        global.fetch = originalFetch
    }
})

test("generation failure returns a visible warning instead of polling forever", async () => {
    const originalFetch = global.fetch
    global.fetch = jest.fn(async () =>
        response({ phase: "failed", warnings: ["Training cancelled; reopen Statistics to retry."] })
    ) as typeof fetch
    try {
        const { ensureFsrsCalibration } = await import("../src/ts/search")
        await expect(
            ensureFsrsCalibration([10], new AbortController().signal, () => {})
        ).resolves.toEqual(["Training cancelled; reopen Statistics to retry."])
    } finally {
        global.fetch = originalFetch
    }
})

test("an unavailable progress endpoint ends the loading label and reports the failure", async () => {
    const originalFetch = global.fetch
    const progress = jest.fn()
    global.fetch = jest
        .fn()
        .mockResolvedValueOnce(response({ phase: "running", coversRequest: true, warnings: [] }))
        .mockRejectedValueOnce(new Error("progress endpoint unavailable")) as typeof fetch
    try {
        const { ensureFsrsCalibration } = await import("../src/ts/search")
        const pending = ensureFsrsCalibration([10], new AbortController().signal, progress)
        await flush()
        await jest.advanceTimersByTimeAsync(1000)
        const warnings = await pending
        expect(warnings.join(" ")).toContain("progress endpoint unavailable")
        expect(progress).toHaveBeenLastCalledWith({ phase: "failed", warnings })
    } finally {
        global.fetch = originalFetch
    }
})
