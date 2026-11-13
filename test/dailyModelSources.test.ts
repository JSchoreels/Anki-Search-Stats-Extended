import { get } from "svelte/store"
import { calibrationSamplesFrom } from "../src/ts/calibrationSamples"
import { createDailyModelSources } from "../src/ts/dailyModelSources"
import { runStatsTask } from "../src/ts/statsWorkerClient"

jest.mock("../src/ts/statsWorkerClient", () => ({ runStatsTask: jest.fn() }))

const worker = runStatsTask as jest.MockedFunction<typeof runStatsTask>
const samples = calibrationSamplesFrom([{ revlogId: 100, cardId: 1, actual: 1 }])
const point = {
    day: 1,
    count: 1,
    actualRecall: 1,
    predictedRecall: 0.8,
    standardizedGap: 0.5,
    logLoss: 0.3,
}
const flush = async () => {
    for (let index = 0; index < 20; index++) await Promise.resolve()
}

beforeEach(() => {
    worker.mockReset()
    worker.mockResolvedValue([point] as never)
})

test("daily scores reuse precomputed defaults and calculate each selected model once", async () => {
    const store = createDailyModelSources()
    const fsrs = new Float64Array([0.8])
    const big = new Float64Array([0.6])
    store.setSamples(samples)
    store.ensure("fsrs", fsrs, [point])
    store.ensure("rwkv-big", big)
    store.ensure("rwkv-big", big)
    await flush()
    expect(worker).toHaveBeenCalledTimes(1)
    expect(worker.mock.calls[0][0]).toBe("dailyPredictionData")
    expect(get(store).fsrs?.data).toEqual([point])
    expect(get(store)["rwkv-big"]?.phase).toBe("ready")
    store.ensure("rwkv-big", big)
    expect(worker).toHaveBeenCalledTimes(1)
    store.destroy()
})

test("unselected or obsolete calculations cannot publish, and failures can be retried", async () => {
    let resolve!: (value: (typeof point)[]) => void
    worker.mockReturnValueOnce(new Promise((done) => (resolve = done)) as never)
    const store = createDailyModelSources()
    store.setSamples(samples)
    store.ensure("rwkv-big", new Float64Array([0.6]))
    const oldSignal = worker.mock.calls[0][2]
    store.select([])
    expect(oldSignal.aborted).toBe(true)
    resolve([point])
    await flush()
    expect(get(store)["rwkv-big"]).toBeUndefined()

    worker.mockRejectedValueOnce(new Error("calculation failed"))
    store.ensure("rwkv-big", new Float64Array([0.6]))
    await flush()
    expect(get(store)["rwkv-big"]).toMatchObject({ phase: "failed", error: "calculation failed" })
    store.retry("rwkv-big")
    await flush()
    expect(get(store)["rwkv-big"]?.phase).toBe("ready")
    store.setSamples(calibrationSamplesFrom([{ revlogId: 200, cardId: 2, actual: 0 }]))
    expect(get(store)).toEqual({})
    store.destroy()
})

test("precomputed daily data replaces an in-flight default calculation", async () => {
    worker.mockReturnValueOnce(new Promise(() => {}) as never)
    const store = createDailyModelSources()
    const predictions = new Float64Array([0.8])
    store.setSamples(samples)
    store.ensure("fsrs", predictions)
    const signal = worker.mock.calls[0][2]
    store.ensure("fsrs", predictions, [point])
    expect(signal.aborted).toBe(true)
    expect(get(store).fsrs).toMatchObject({ phase: "ready", data: [point] })
    store.destroy()
})
