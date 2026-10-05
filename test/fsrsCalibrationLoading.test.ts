import { get } from "svelte/store"

const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve()
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
        runStatsTask: async (task: string, args: unknown[]) => {
            if (task !== "calibration") return null
            const { buildCalibrationBins } = await import("../src/ts/MemorisedBar")
            return buildCalibrationBins(args[0] as never, args[1] as never)
        },
    }))
    try {
        const stores = await import("../src/ts/stores")
        stores.cids.set([10])
        await flush()
        stores.memorised_stats.set({
            calibration_samples: ids.map((revlogId) => ({ cid: 10, revlogId, actual: 1 })),
            fsrs_calibration_predictions_by_revlog_id: Object.fromEntries(
                ids.map((id) => [id, 0.85])
            ),
        } as never)
        await flush()
        expect(get(stores.fsrsCalibrationStats)?.cachedPredictionCount).toBe(1)
        expect(get(stores.rwkvCalibrationStats)).not.toBeNull()
        expect(get(stores.fsrsCalibrationGeneration)?.phase).toBe("queued")
        expect(requests.filter((url) => url.endsWith("startFsrsCalibration"))).toHaveLength(1)
        expect(alignmentBody).not.toHaveProperty("ensure_fsrs_alignment")
        await jest.advanceTimersByTimeAsync(1000)
        await flush()
        const fsrs = get(stores.fsrsCalibrationStats)!
        expect(fsrs.cachedPredictionCount).toBe(3)
        expect(fsrs.roles).toEqual(["validation_fold"])
        expect(fsrs.bins.reduce((sum, bin) => sum + (bin?.count ?? 0), 0)).toBe(3)
        expect(Object.keys(get(stores.rwkvCalibrationStats)!.predictionsByRevlogId)).toHaveLength(3)
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
    jest.doMock("../src/ts/statsWorkerClient", () => ({ runStatsTask: async () => [] }))
    try {
        const stores = await import("../src/ts/stores")
        stores.cids.set([10])
        await flush()
        stores.memorised_stats.set({
            calibration_samples: [{ cid: 10, revlogId: 100, actual: 1 }],
            fsrs_calibration_predictions_by_revlog_id: { 100: 0.9 },
        } as never)
        await flush()
        expect(get(stores.fsrsCalibrationStats)).toBeNull()
        expect(get(stores.rwkvCalibrationStats)?.predictionsByRevlogId).toEqual({ 100: 0.8 })
        expect(get(stores.fsrsCalibrationGeneration)?.phase).toBe("running")
        stores.cids.set(null)
    } finally {
        global.fetch = originalFetch
    }
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
