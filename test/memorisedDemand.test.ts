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

test.each([
    [[], false],
    [["misc:review-speed-trend"], false],
    [["misc:sxr-heatmap"], true],
    [["misc:ease-factors"], true],
    [["misc:sxr-heatmap"], false, ["misc:sxr-heatmap"]],
    [[], false, ["misc:sxr-heatmap", "misc:ease-factors"], true],
] as [string[], boolean, string[]?, boolean?][])(
    "saved favorites %j request only their needed presets",
    async (pinnedGraphs, presetsNeeded, hiddenGraphs = [], misc = false) => {
        const originalFetch = global.fetch,
            originalConfig = global.SSEconfig
        global.SSEconfig = {
            categories: { misc, lapse: false, introduced: false },
            pinnedGraphs,
            hiddenGraphs,
        } as never
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
            expect(requests.some((url) => url.endsWith("fsrsPresetData"))).toBe(presetsNeeded)
            expect(requests.some((url) => url.endsWith("writeConfig"))).toBe(false)
            expect(loadHistory).not.toHaveBeenCalled()
            if (hiddenGraphs.length) {
                stores.showHiddenGraphs.set(true)
                await flush()
                expect(requests.some((url) => url.endsWith("fsrsPresetData"))).toBe(true)
                expect(get(stores.hiddenGraphs.ids)).toEqual(hiddenGraphs)
                expect(requests.some((url) => url.endsWith("writeConfig"))).toBe(false)
                expect(loadHistory).not.toHaveBeenCalled()
            }
            stores.cids.set(null)
        } finally {
            global.fetch = originalFetch
            global.SSEconfig = originalConfig
        }
    }
)

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
            if (url.endsWith("startRwkvReviewGain"))
                return response({ jobId: 1, phase: "complete", done: true })
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
            if (mode === "memorised") stores.memorisedPerReviewMode.set("both")
            else stores.memorisedMode.set("both")
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
            expect(requests.some((url) => url.endsWith("startRwkvMemorisedHistory"))).toBe(
                mode !== "memorised"
            )
            expect(requests.some((url) => url.endsWith("startRwkvReviewGain"))).toBe(
                mode === "memorised"
            )
            stores.cids.set(null)
        } finally {
            global.fetch = originalFetch
            global.SSEconfig = originalConfig
        }
    }
)

test("changing the search cancels the old RWKV gain start before starting the new one", async () => {
    const originalFetch = global.fetch,
        originalConfig = global.SSEconfig
    global.SSEconfig = { categories: { misc: false, lapse: false } } as never
    const events: string[] = []
    let finishFirst: (value: ReturnType<typeof response>) => void = () => {}
    global.fetch = jest.fn(async (url: string, options?: RequestInit) => {
        if (url.endsWith("startRwkvReviewGain")) {
            const card = JSON.parse(options?.body as string).cids[0]
            events.push(`start ${card}`)
            if (card === 10)
                return new Promise<ReturnType<typeof response>>((resolve) => {
                    finishFirst = resolve
                })
            return response({ jobId: 2, phase: "complete", slowReplay: true, done: true })
        }
        if (url.endsWith("cancelRwkvReviewGain")) {
            events.push(`cancel ${JSON.parse(options?.body as string).job_id}`)
            return response({})
        }
        if (url.endsWith("cardData")) return response({ columns: ["id", "did", "odid"], data: [] })
        return response({ presets: [], cards: {}, retrievability: {} })
    }) as typeof fetch
    jest.doMock("../src/ts/statsWorkerClient", () => ({
        loadStatsHistory: jest.fn(),
        runStatsTask: jest.fn(),
    }))
    try {
        const stores = await import("../src/ts/stores")
        stores.cids.set([10])
        stores.memorisedPerReviewMode.set("both")
        stores.showMemorisedStats.set(true)
        await flush()
        expect(events).toEqual(["start 10"])
        stores.cids.set([20])
        await flush()
        expect(events).toEqual(["start 10"])
        finishFirst(response({ jobId: 1, phase: "computing", done: false }))
        await flush()
        expect(events).toEqual(["start 10", "cancel 1", "start 20"])
        expect(get(stores.rwkvReviewGainStats)?.jobId).toBe(2)
        expect(get(stores.rwkvReviewGainStats)?.slowReplay).toBe(true)
        stores.cids.set(null)
    } finally {
        global.fetch = originalFetch
        global.SSEconfig = originalConfig
    }
})

test("changing the recall horizon cancels an outdated RWKV replay before starting another", async () => {
    const originalFetch = global.fetch,
        originalConfig = global.SSEconfig
    global.SSEconfig = { categories: { misc: false, lapse: false } } as never
    const events: string[] = []
    let finishFirst: (value: ReturnType<typeof response>) => void = () => {}
    global.fetch = jest.fn(async (url: string, options?: RequestInit) => {
        if (url.endsWith("startRwkvReviewGain")) {
            const horizon = JSON.parse(options?.body as string).horizon_seconds
            events.push(`start ${horizon}`)
            if (horizon === 0)
                return new Promise<ReturnType<typeof response>>((resolve) => {
                    finishFirst = resolve
                })
            return response({ jobId: 2, phase: "complete", done: true, withByDay: [0.8] })
        }
        if (url.endsWith("cancelRwkvReviewGain")) {
            events.push(`cancel ${JSON.parse(options?.body as string).job_id}`)
            return response({})
        }
        if (url.endsWith("cardData")) return response({ columns: ["id", "did", "odid"], data: [] })
        return response({ presets: [], cards: {}, retrievability: {} })
    }) as typeof fetch
    jest.doMock("../src/ts/statsWorkerClient", () => ({
        loadStatsHistory: jest.fn(),
        runStatsTask: jest.fn(),
    }))
    try {
        const stores = await import("../src/ts/stores")
        stores.cids.set([10])
        stores.memorisedPerReviewMode.set("both")
        stores.showMemorisedStats.set(true)
        await flush()
        stores.reviewGainHorizon.set(600)
        await flush()
        expect(events).toEqual(["start 0"])
        finishFirst(response({ jobId: 1, phase: "computing", done: false }))
        await flush()
        expect(events).toEqual(["start 0", "cancel 1", "start 600"])
        expect(get(stores.rwkvReviewGainStats)?.jobId).toBe(2)
        stores.cids.set(null)
    } finally {
        global.fetch = originalFetch
        global.SSEconfig = originalConfig
    }
})
