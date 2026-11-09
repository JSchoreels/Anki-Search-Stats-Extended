import { get } from "svelte/store"

const flush = async () => {
    for (let i = 0; i < 60; i++) await Promise.resolve()
}
const nextPoll = () => new Promise((resolve) => setTimeout(resolve, 600))
const response = (value: unknown) => ({ ok: true, text: async () => JSON.stringify(value) })
type Reply =
    | ReturnType<typeof response>
    | { ok: false; status: number; text: () => Promise<string> }

let originalFetch: typeof fetch
let originalConfig: typeof SSEconfig
let originalDaysElapsed: number

beforeEach(() => {
    jest.resetModules()
    originalFetch = global.fetch
    originalConfig = global.SSEconfig
    originalDaysElapsed = SSEother.days_elapsed
    global.SSEconfig = { categories: { misc: false, lapse: false } } as never
    SSEother.days_elapsed = 100
    jest.doMock("../src/ts/statsWorkerClient", () => ({
        loadStatsHistory: jest.fn(),
        runStatsTask: jest.fn(),
    }))
})
afterEach(() => {
    global.fetch = originalFetch
    global.SSEconfig = originalConfig
    SSEother.days_elapsed = originalDaysElapsed
    jest.dontMock("../src/ts/statsWorkerClient")
    jest.resetModules()
})

// Records the RWKV stability requests and answers the rest like an empty collection.
function mockFetch(
    events: string[],
    replies: {
        start: (card: number) => Reply | Promise<Reply>
        progress?: (jobId: number) => Reply
    }
) {
    global.fetch = jest.fn(async (url: string, options?: RequestInit) => {
        const body = options?.body ? JSON.parse(options.body as string) : {}
        if (url.endsWith("startRwkvStabilityHistory")) {
            events.push(`start ${body.cids[0]}`)
            return replies.start(body.cids[0])
        }
        if (url.endsWith("rwkvStabilityHistoryProgress")) {
            events.push(`progress ${body.job_id}`)
            return replies.progress!(body.job_id)
        }
        if (url.endsWith("cancelRwkvStabilityHistory")) {
            events.push(`cancel ${body.job_id}`)
            return response({})
        }
        if (url.endsWith("cardData")) return response({ columns: ["id", "did", "odid"], data: [] })
        return response({ presets: [], cards: {}, retrievability: {} })
    }) as typeof fetch
}

test("RWKV stability runs only outside FSRS mode, keeps running across RWKV and Both, and anchors days", async () => {
    const events: string[] = []
    const series = (days: number) => ({
        firstDay: 98,
        medianByDay: [2, null, 5].slice(0, days),
        meanByDay: [3, null, 6].slice(0, days),
        youngRatioByDay: [1, null, 0.5].slice(0, days),
        cardCountByDay: [1, 0, 2].slice(0, days),
    })
    mockFetch(events, {
        start: () =>
            response({
                jobId: 1,
                phase: "computing",
                current: 1,
                total: 4,
                done: false,
                ...series(2),
            }),
        progress: () =>
            response({
                jobId: 1,
                phase: "complete",
                current: 4,
                total: 4,
                done: true,
                ...series(3),
            }),
    })
    const stores = await import("../src/ts/stores")
    const { today } = await import("../src/ts/revlogGraphs")
    stores.cids.set([10])
    stores.showMemorisedStats.set(true)
    await flush()
    expect(events).toEqual([])
    expect(get(stores.rwkvStabilityStats)).toBeNull()

    stores.stabilityOverTimeMode.set("rwkv")
    await flush()
    expect(events).toEqual(["start 10"])
    const partial = get(stores.rwkvStabilityStats)!
    expect(partial).toMatchObject({
        jobId: 1,
        phase: "computing",
        current: 1,
        total: 4,
        done: false,
    })
    expect(partial.medianDays[today - 2]).toBe(2)
    expect(partial.medianDays[today - 1]).toBeNaN()
    expect(partial.medianDays).toHaveLength(today)

    stores.stabilityOverTimeMode.set("both")
    await flush()
    expect(events).toEqual(["start 10"])

    await nextPoll()
    await flush()
    expect(events).toEqual(["start 10", "progress 1"])
    const complete = get(stores.rwkvStabilityStats)!
    expect(complete).toMatchObject({ phase: "complete", done: true, error: null })
    expect(complete.medianDays[today]).toBe(5)
    expect(complete.meanDays[today]).toBe(6)
    expect(complete.youngRatioDays[today]).toBe(0.5)
    expect(complete.cardCountDays[today]).toBe(2)

    stores.stabilityOverTimeMode.set("fsrs")
    await flush()
    expect(get(stores.rwkvStabilityStats)).toBeNull()
    // A finished replay is not cancelled.
    expect(events).toEqual(["start 10", "progress 1"])
    stores.cids.set(null)
})

test("changing the search cancels the outdated RWKV stability start before starting the next", async () => {
    const events: string[] = []
    let finishFirst: (value: Reply) => void = () => {}
    mockFetch(events, {
        start: (card) =>
            card === 10
                ? new Promise<Reply>((resolve) => {
                      finishFirst = resolve
                  })
                : response({ jobId: 2, phase: "complete", firstDay: null, done: true }),
    })
    const stores = await import("../src/ts/stores")
    stores.cids.set([10])
    stores.stabilityOverTimeMode.set("rwkv")
    stores.showMemorisedStats.set(true)
    await flush()
    expect(events).toEqual(["start 10"])
    stores.cids.set([20])
    await flush()
    expect(events).toEqual(["start 10"])
    finishFirst(response({ jobId: 1, phase: "computing", done: false }))
    await flush()
    expect(events).toEqual(["start 10", "cancel 1", "start 20"])
    expect(get(stores.rwkvStabilityStats)).toMatchObject({ jobId: 2, done: true, medianDays: [] })
    stores.cids.set(null)
})

test("RWKV stability cancellation, unavailable RWKV, and request errors end in a final state", async () => {
    const events: string[] = []
    mockFetch(events, {
        start: (card) =>
            card === 10
                ? response({ jobId: 3, phase: "computing", current: 0, total: 5, done: false })
                : card === 20
                  ? response({ phase: "failed", done: true, error: "RWKV is unavailable" })
                  : { ok: false, status: 500, text: async () => "boom" },
        progress: (jobId) => response({ jobId, phase: "cancelled", done: true }),
    })
    const stores = await import("../src/ts/stores")
    stores.cids.set([10])
    stores.stabilityOverTimeMode.set("both")
    stores.showMemorisedStats.set(true)
    await flush()
    expect(get(stores.rwkvStabilityStats)?.jobId).toBe(3)
    await stores.cancelRwkvStabilityComputation()
    expect(events).toEqual(["start 10", "cancel 3"])
    await nextPoll()
    await flush()
    expect(get(stores.rwkvStabilityStats)).toMatchObject({ phase: "cancelled", done: true })

    stores.cids.set([20])
    await flush()
    expect(events).toEqual(["start 10", "cancel 3", "progress 3", "start 20"])
    expect(get(stores.rwkvStabilityStats)).toMatchObject({
        jobId: null,
        phase: "failed",
        done: true,
        error: "RWKV is unavailable",
    })

    stores.cids.set([30])
    await flush()
    expect(get(stores.rwkvStabilityStats)).toMatchObject({
        jobId: null,
        phase: "failed",
        done: true,
        error: "Endpoint startRwkvStabilityHistory failed: 500 boom",
    })
    stores.cids.set(null)
})
