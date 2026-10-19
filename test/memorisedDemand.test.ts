import { get } from "svelte/store"
import { calibrationSamplesFrom } from "../src/ts/calibrationSamples"

const flush = async () => {
    for (let i = 0; i < 60; i++) await Promise.resolve()
}
const response = (value: unknown) => ({ ok: true, text: async () => JSON.stringify(value) })
beforeEach(() => jest.resetModules())
afterEach(() => {
    jest.dontMock("../src/ts/statsWorkerClient")
    jest.resetModules()
})

test.each([undefined, true, false, "removed"])(
    "Lapse visibility %s needs neither current presets nor review history",
    async (visibility) => {
        const originalFetch = global.fetch,
            originalConfig = global.SSEconfig
        global.SSEconfig = { categories: { misc: false, lapse: visibility } } as never
        const requests: string[] = []
        const loadHistory = jest.fn()
        global.fetch = jest.fn(async (url: string) => {
            requests.push(url)
            if (url.endsWith("cardData"))
                return response({ columns: ["id", "did", "odid"], data: [[10, 1, 0]] })
            return response({ presets: [], cards: {}, retrievability: {} })
        }) as typeof fetch
        jest.doMock("../src/ts/statsWorkerClient", () => ({
            loadStatsHistory: loadHistory,
            runStatsTask: jest.fn(),
        }))
        try {
            const stores = await import("../src/ts/stores")
            stores.cids.set([10])
            await flush()
            const presetRequests = () =>
                requests.filter((url) => url.endsWith("fsrsPresetData")).length
            expect(presetRequests()).toBe(0)

            stores.shownCategories.set({ misc: false, lapse: false })
            stores.cids.set([20])
            await flush()
            expect(presetRequests()).toBe(0)

            stores.shownCategories.set({ misc: false, lapse: true })
            await flush()
            expect(presetRequests()).toBe(0)
            expect(loadHistory).not.toHaveBeenCalled()
            expect(get(stores.showRevlogStats)).toBe(false)
            expect(get(stores.showMemorisedStats)).toBe(false)
            stores.cids.set(null)
        } finally {
            global.fetch = originalFetch
            global.SSEconfig = originalConfig
        }
    }
)

test("daily maturation loads all history only on request, releases it, and rejects obsolete results", async () => {
    const originalFetch = global.fetch,
        originalConfig = global.SSEconfig
    global.SSEconfig = { categories: { misc: false, lapse: false, introduced: true } } as never
    const requests: string[] = []
    global.fetch = jest.fn(async (url: string) => {
        requests.push(url)
        if (url.endsWith("cardData"))
            return response({ columns: ["id", "did", "odid"], data: [[10, 1, 0]] })
        return response({ presets: [], cards: {}, retrievability: {} })
    }) as typeof fetch
    const histories: { dispose: jest.Mock }[] = []
    const pending: { signal: AbortSignal; finish: () => void }[] = []
    const loadHistory = jest.fn(async () => {
        const history = { dispose: jest.fn() }
        histories.push(history)
        return history
    })
    const runTask = jest.fn((task: string, args: unknown[], signal: AbortSignal) => {
        const throughDay = pending.length + 1
        return new Promise((resolve) =>
            pending.push({
                signal,
                finish: () => resolve({ cards: [], incompleteCards: 0, throughDay }),
            })
        )
    })
    jest.doMock("../src/ts/statsWorkerClient", () => ({
        loadStatsHistory: loadHistory,
        runStatsTask: runTask,
    }))
    let stop = () => {}
    try {
        const stores = await import("../src/ts/stores")
        stop = stores.maturationHistory.subscribe(() => {})
        stores.cids.set([10])
        await flush()
        expect(loadHistory).not.toHaveBeenCalled()
        stores.showMaturationStats.set(true)
        await flush()
        expect(loadHistory).toHaveBeenCalledWith([10], 0, expect.any(AbortSignal))
        expect(runTask.mock.calls.map(([task]) => task)).toEqual(["maturation"])
        stores.cids.set([20])
        await flush()
        expect(pending).toHaveLength(2)
        expect(pending[0].signal.aborted).toBe(true)
        pending[1].finish()
        await flush()
        expect(get(stores.maturationHistory)?.throughDay).toBe(2)
        pending[0].finish()
        await flush()
        expect(get(stores.maturationHistory)?.throughDay).toBe(2)
        histories.forEach((history) => expect(history.dispose).toHaveBeenCalledTimes(1))
        expect(get(stores.showRevlogStats)).toBe(false)
        expect(get(stores.showMemorisedStats)).toBe(false)
        expect(requests.some((url) => url.endsWith("startFsrsCalibration"))).toBe(false)
        stores.cids.set(null)
    } finally {
        stop()
        global.fetch = originalFetch
        global.SSEconfig = originalConfig
    }
})

test.each(["comparison", "memorised", "automatic", "empty cache"])(
    "%s requests only the necessary historical tasks",
    async (mode) => {
        const originalFetch = global.fetch,
            originalConfig = global.SSEconfig
        global.SSEconfig = {
            autoMemorisedStats: mode === "automatic",
            autoRevlogStats: mode === "automatic",
        } as never
        const samples = calibrationSamplesFrom([{ revlogId: 100, cardId: 10, actual: 1 }])
        const tasks: string[] = [],
            requests: string[] = []
        global.fetch = jest.fn(async (url: string) => {
            requests.push(url)
            if (url.endsWith("cardData"))
                return response({ columns: ["id", "did", "odid"], data: [[10, 1, 0]] })
            if (url.endsWith("revlogs"))
                return response({
                    columns: ["id", "cid", "ease", "ivl", "lastIvl", "time", "factor", "type"],
                    data: [[100, 10, 3, 1, 0, 1000, 2500, 0]],
                    next_after_id: null,
                })
            if (url.endsWith("fsrsPresetData"))
                return response({ presets: [], cards: {}, retrievability: {} })
            if (url.endsWith("startFsrsCalibration"))
                return response({ phase: "ready", generated: false, warnings: [] })
            if (url.endsWith("fsrsReviewRetrievability"))
                return response({ data: mode === "empty cache" ? [] : [[100, 0.9]] })
            if (url.endsWith("rwkvReviewRetrievability")) return response({ data: [[100, 0.8]] })
            if (url.endsWith("startRwkvMemorisedHistory")) return response({ done: true })
            return response({})
        }) as typeof fetch
        jest.doMock("../src/ts/statsWorkerClient", () => ({
            loadStatsHistory: async (cids: number[], days: number, signal: AbortSignal) => {
                const { getRevlogs } = await import("../src/ts/search")
                const { lastForgetByCard } = await import("../src/ts/revlogMetadata")
                const history = await getRevlogs(cids, days, signal)
                return history && Object.assign(history, { lastForget: lastForgetByCard(history) })
            },
            runStatsTask: async (task: string, args: never) => {
                tasks.push(task)
                if (task === "revlog") return {}
                if (task === "calibrationSamples") return samples
                if (task === "memorised")
                    return {
                        calibration_samples: samples,
                        fsrs_calibration_replay_predictions: new Float64Array([0.85]),
                    }
                const { runStatsTaskLocally } = await import("../src/ts/statsTasks")
                return runStatsTaskLocally(task as never, args)
            },
        }))
        try {
            const stores = await import("../src/ts/stores")
            stores.cids.set([10])
            stores.memorisedMode.set("both")
            if (mode !== "automatic") stores.requestFsrsStats(mode === "memorised")
            await flush()
            expect(tasks).toContain("calibrationSamples")
            expect(get(stores.fsrsCalibrationStats)).not.toBeNull()
            if (mode === "comparison") {
                expect(tasks).not.toContain("memorised")
                expect(requests.some((url) => url.endsWith("startRwkvMemorisedHistory"))).toBe(
                    false
                )
                expect(get(stores.showMemorisedStats)).toBe(false)
                // A later Memorised Calculate action starts history once.
                stores.requestFsrsStats(true)
                await flush()
            }
            expect(tasks.filter((task) => task === "memorised")).toHaveLength(1)
            expect(get(stores.showMemorisedStats)).toBe(true)
            stores.cids.set(null)
        } finally {
            global.fetch = originalFetch
            global.SSEconfig = originalConfig
        }
    }
)
