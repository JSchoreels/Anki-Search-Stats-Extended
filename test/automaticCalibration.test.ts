import { get } from "svelte/store"

const flush = async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve()
}
const response = (value: unknown) => ({ ok: true, text: async () => JSON.stringify(value) })
const history = {
    calibration_samples: [{ cardId: 10, revlogId: 100, actual: 1 }],
    fsrs_calibration_predictions_by_revlog_id: { 100: 0.9 },
}
let originalFetch: typeof fetch
beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    originalFetch = global.fetch
    jest.doMock("../src/ts/statsWorkerClient", () => ({ runStatsTask: async () => [] }))
})
afterEach(() => {
    global.fetch = originalFetch
    jest.useRealTimers()
    jest.dontMock("../src/ts/statsWorkerClient")
    jest.resetModules()
})

test("a cancelled automatic job stays stopped through search and date changes", async () => {
    const starts: unknown[] = []
    global.fetch = jest.fn(async (url: string, options) => {
        if (url.endsWith("startFsrsCalibration")) {
            starts.push(JSON.parse(options!.body as string))
            return response({
                phase: "failed",
                warnings: ["Cancelled; reopen Statistics to retry."],
            })
        }
        return response({ columns: [], data: [], presets: [], cards: {}, retrievability: {} })
    }) as typeof fetch
    const stores = await import("../src/ts/stores")
    stores.cids.set([10])
    await flush()
    stores.memorised_stats.set(history as never)
    await flush()
    expect(get(stores.fsrsCalibrationGeneration)?.phase).toBe("failed")
    stores.cids.set([20])
    await flush()
    stores.memorised_stats.set(history as never)
    stores.alwaysAllTime.set(true)
    await jest.advanceTimersByTimeAsync(3000)
    expect(starts).toEqual([{ cids: [10] }])
    stores.cids.set(null)
})

test("a new selection waits for the active job and prepares its own cards afterwards", async () => {
    const starts: unknown[] = []
    global.fetch = jest.fn(async (url: string, options) => {
        if (url.endsWith("startFsrsCalibration")) {
            starts.push(JSON.parse(options!.body as string))
            return response({ phase: "running", coversRequest: true, warnings: [] })
        }
        if (url.endsWith("fsrsCalibrationProgress"))
            return response({ phase: "ready", warnings: [] })
        return response({ columns: [], data: [], presets: [], cards: {}, retrievability: {} })
    }) as typeof fetch
    const stores = await import("../src/ts/stores")
    stores.cids.set([10])
    await flush()
    stores.memorised_stats.set(history as never)
    await flush()
    stores.cids.set([20])
    await flush()
    stores.memorised_stats.set(history as never)
    await flush()
    expect(starts).toEqual([{ cids: [10] }])
    await jest.advanceTimersByTimeAsync(1000)
    await flush()
    expect(starts).toEqual([{ cids: [10] }, { cids: [20] }])
    await jest.advanceTimersByTimeAsync(1000)
    await flush()
    expect(get(stores.fsrsCalibrationGeneration)?.phase).toBe("ready")
    stores.memorised_stats.set({ ...history } as never)
    await flush()
    expect(starts).toHaveLength(2)
    stores.cids.set(null)
})
