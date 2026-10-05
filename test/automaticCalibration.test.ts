import { get } from "svelte/store"
import { calibrationSamplesFrom } from "../src/ts/calibrationSamples"

const flush = async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve()
}
const response = (value: unknown) => ({ ok: true, text: async () => JSON.stringify(value) })
const history = {
    calibration_samples: calibrationSamplesFrom([{ cardId: 10, revlogId: 100, actual: 1 }]),
    fsrs_calibration_replay_predictions: new Float64Array([0.9]),
}
let originalFetch: typeof fetch
beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    originalFetch = global.fetch
    jest.doMock("../src/ts/statsWorkerClient", () => ({
        runStatsTask: async (task: keyof import("../src/ts/statsTasks").Tasks, args: never) => {
            const { runStatsTaskLocally } = await import("../src/ts/statsTasks")
            return runStatsTaskLocally(task, args)
        },
    }))
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

test("an unchanged cache check keeps both graph objects without another cache request or bin calculation", async () => {
    const requests: string[] = []
    const worker = jest.fn(
        async (task: keyof import("../src/ts/statsTasks").Tasks, args: never) => {
            const { runStatsTaskLocally } = await import("../src/ts/statsTasks")
            return runStatsTaskLocally(task, args)
        }
    )
    jest.doMock("../src/ts/statsWorkerClient", () => ({ runStatsTask: worker }))
    global.fetch = jest.fn(async (url: string) => {
        requests.push(url)
        if (url.endsWith("startFsrsCalibration"))
            return response({ phase: "running", coversRequest: true, warnings: [] })
        if (url.endsWith("fsrsCalibrationProgress"))
            return response({ phase: "ready", generated: false, warnings: [] })
        if (url.endsWith("fsrsReviewRetrievability") || url.endsWith("rwkvReviewRetrievability"))
            return response({ column: "cache", data: [[100, 0.9]] })
        return response({ columns: [], data: [], presets: [], cards: {}, retrievability: {} })
    }) as typeof fetch
    const stores = await import("../src/ts/stores")
    stores.cids.set([10])
    await flush()
    stores.memorised_stats.set(history as never)
    await flush()
    const fsrs = get(stores.fsrsCalibrationStats)
    const rwkv = get(stores.rwkvCalibrationStats)
    expect(fsrs).not.toBeNull()
    expect(rwkv).not.toBeNull()
    const callsBefore = worker.mock.calls.length
    await jest.advanceTimersByTimeAsync(1000)
    await flush()
    expect(get(stores.fsrsCalibrationStats)).toBe(fsrs)
    expect(get(stores.rwkvCalibrationStats)).toBe(rwkv)
    expect(worker).toHaveBeenCalledTimes(callsBefore)
    for (const endpoint of ["fsrsReviewRetrievability", "rwkvReviewRetrievability"])
        expect(requests.filter((url) => url.endsWith(endpoint))).toHaveLength(1)
    stores.cids.set(null)
})

test.each([false, true])(
    "a no-op FSRS check refreshes only deferred RWKV data (cache response late: %s)",
    async (late) => {
        const requests: string[] = []
        let release: (value: unknown) => void = () => {}
        let rwkvCalls = 0
        global.fetch = jest.fn(async (url: string) => {
            requests.push(url)
            if (url.endsWith("startFsrsCalibration"))
                return response({ phase: "running", coversRequest: true, warnings: [] })
            if (url.endsWith("fsrsCalibrationProgress"))
                return response({ phase: "ready", generated: false, warnings: [] })
            if (url.endsWith("fsrsReviewRetrievability"))
                return response({ column: "cache", data: [[100, 0.9]] })
            if (url.endsWith("rwkvReviewRetrievability")) {
                rwkvCalls++
                if (rwkvCalls > 1) return response({ column: "rwkv", data: [[100, 0.8]] })
                const deferred = response({ data: [], refresh_after_fsrs: true })
                return late
                    ? new Promise((resolve) => {
                          release = resolve
                      })
                    : deferred
            }
            return response({ columns: [], data: [], presets: [], cards: {}, retrievability: {} })
        }) as typeof fetch
        const stores = await import("../src/ts/stores")
        stores.cids.set([10])
        await flush()
        stores.memorised_stats.set(history as never)
        await flush()
        await jest.advanceTimersByTimeAsync(1000)
        if (late) release(response({ data: [], refresh_after_fsrs: true }))
        await flush()
        expect(get(stores.rwkvCalibrationStats)?.predictions).toEqual(new Float64Array([0.8]))
        expect(requests.filter((url) => url.endsWith("rwkvReviewRetrievability"))).toHaveLength(2)
        expect(requests.filter((url) => url.endsWith("fsrsReviewRetrievability"))).toHaveLength(1)
        stores.cids.set(null)
    }
)
