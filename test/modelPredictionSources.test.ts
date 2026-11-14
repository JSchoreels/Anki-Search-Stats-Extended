import { get } from "svelte/store"
import { calibrationSamplesFrom } from "../src/ts/calibrationSamples"
import { createModelPredictionSources } from "../src/ts/modelPredictionSources"
import { getFsrsSixComparisonPages, getRwkvUmPlusModelPages } from "../src/ts/search"
import { runStatsTask } from "../src/ts/statsWorkerClient"

jest.mock("../src/ts/search", () => ({
    getRwkvUmPlusModelPages: jest.fn(),
    getFsrsSixComparisonPages: jest.fn(),
}))
jest.mock("../src/ts/statsWorkerClient", () => ({ runStatsTask: jest.fn() }))

const pages = getRwkvUmPlusModelPages as jest.MockedFunction<typeof getRwkvUmPlusModelPages>
const fsrs6Pages = getFsrsSixComparisonPages as jest.MockedFunction<
    typeof getFsrsSixComparisonPages
>
const worker = runStatsTask as jest.MockedFunction<typeof runStatsTask>
const samples = calibrationSamplesFrom([{ revlogId: 100, cardId: 10, actual: 1 }])
const flush = async () => {
    for (let index = 0; index < 20; index++) await Promise.resolve()
}

beforeEach(() => {
    pages.mockReset()
    fsrs6Pages.mockReset()
    worker.mockReset()
    pages.mockResolvedValue("model-predictions")
    fsrs6Pages.mockResolvedValue("model-predictions")
    worker.mockImplementation(async (task) => {
        if (task === "calibrationPredictions")
            return {
                predictions: new Float64Array([0.8]),
                bins: [{ real: 1, predicted: 0.8, count: 1 }],
                warnings: [],
            } as never
        if (task === "calibrationBands") return [[0.2, 0.9]] as never
        throw new Error(`Unexpected task ${task}`)
    })
})

test("FSRS-6 uses held-out predictions for the selected cards' home decks", async () => {
    const source = createModelPredictionSources()
    source.setSamples(samples, [
        { id: 10, did: 900, odid: 12 },
        { id: 20, did: 13, odid: 0 },
    ])
    source.ensure("fsrs6")
    source.ensure("fsrs6", true)
    await flush()
    expect(fsrs6Pages).toHaveBeenCalledTimes(1)
    expect(fsrs6Pages.mock.calls[0].slice(0, 3)).toEqual([
        [12],
        samples.revlogIds,
        "validation_fold",
    ])
    expect(get(source).fsrs6?.phase).toBe("ready")
    expect(get(source).fsrs6?.bandsReady).toBe(true)
    source.destroy()
})

test("UM+ and Calibration share one model request; bands are computed only when needed", async () => {
    const source = createModelPredictionSources()
    source.setSamples(samples)
    source.ensure("rwkv-big")
    source.ensure("rwkv-big")
    await flush()
    expect(pages).toHaveBeenCalledTimes(1)
    expect(worker.mock.calls.map(([task]) => task)).toEqual(["calibrationPredictions"])
    const prediction = get(source)["rwkv-big"]!.predictions

    source.ensure("rwkv-big", true)
    source.ensure("rwkv-big", true)
    await flush()
    const state = get(source)["rwkv-big"]!
    expect(worker.mock.calls.map(([task]) => task)).toEqual([
        "calibrationPredictions",
        "calibrationBands",
    ])
    expect(worker.mock.calls[1][1]).toEqual([samples, prediction])
    expect(state.predictions).toBe(prediction)
    expect(state.bins?.[0].confidenceInterval).toEqual([0.2, 0.9])
    expect(state.bandsPending).toBe(false)
    expect(state.bandsReady).toBe(true)
    source.ensure("rwkv-big", true)
    await flush()
    expect(worker).toHaveBeenCalledTimes(2)
    source.destroy()
})

test("a confidence request made during model loading runs after the predictions arrive", async () => {
    let resolve!: (value: string) => void
    pages.mockReturnValue(new Promise((done) => (resolve = done)))
    const source = createModelPredictionSources()
    source.setSamples(samples)
    source.ensure("rwkv-small-instant")
    source.ensure("rwkv-small-instant", true)
    expect(get(source)["rwkv-small-instant"]?.phase).toBe("loading")
    resolve("model-predictions")
    await flush()
    expect(pages).toHaveBeenCalledTimes(1)
    expect(worker.mock.calls.map(([task]) => task)).toEqual([
        "calibrationPredictions",
        "calibrationBands",
    ])
    expect(get(source)["rwkv-small-instant"]?.bins?.[0].confidenceInterval).toEqual([0.2, 0.9])
    source.destroy()
})

test("changing the sample aborts the old request and never publishes its result", async () => {
    let resolve!: (value: string) => void
    pages.mockReturnValueOnce(new Promise((done) => (resolve = done)))
    const source = createModelPredictionSources()
    source.setSamples(samples)
    source.ensure("rwkv-big")
    const signal = pages.mock.calls[0][2]
    const otherSamples = calibrationSamplesFrom([{ revlogId: 200, cardId: 20, actual: 0 }])
    source.setSamples(otherSamples)
    expect(signal.aborted).toBe(true)
    resolve("old-predictions")
    await flush()
    expect(get(source)).toEqual({})
    expect(worker).not.toHaveBeenCalled()
    source.ensure("rwkv-big", true)
    await flush()
    expect(pages).toHaveBeenCalledTimes(2)
    expect(pages.mock.calls[1][1]).toEqual(otherSamples.revlogIds)
    expect(get(source)["rwkv-big"]?.phase).toBe("ready")
    source.destroy()
})

test("a failed model request can be retried for either graph", async () => {
    pages.mockRejectedValueOnce(new Error("model missing"))
    const source = createModelPredictionSources()
    source.setSamples(samples)
    source.ensure("rwkv-tiny-instant", true)
    await flush()
    expect(get(source)["rwkv-tiny-instant"]).toMatchObject({
        phase: "failed",
        error: "model missing",
    })
    source.retry("rwkv-tiny-instant")
    await flush()
    expect(get(source)["rwkv-tiny-instant"]?.phase).toBe("ready")
    expect(get(source)["rwkv-tiny-instant"]?.bins?.[0].confidenceInterval).toEqual([0.2, 0.9])
    source.destroy()
})

test("a confidence calculation cannot publish into a new search", async () => {
    let resolve!: (value: Array<[number, number]>) => void
    worker.mockImplementation(async (task) => {
        if (task === "calibrationPredictions")
            return {
                predictions: new Float64Array([0.8]),
                bins: [{ real: 1, predicted: 0.8, count: 1 }],
                warnings: [],
            } as never
        if (task === "calibrationBands")
            return (await new Promise((done) => (resolve = done))) as never
        throw new Error(`Unexpected task ${task}`)
    })
    const source = createModelPredictionSources()
    source.setSamples(samples)
    source.ensure("rwkv-big", true)
    await flush()
    expect(get(source)["rwkv-big"]?.bandsPending).toBe(true)
    const signal = worker.mock.calls.find(([task]) => task === "calibrationBands")![2]
    source.setSamples(calibrationSamplesFrom([{ revlogId: 200, cardId: 20, actual: 0 }]))
    expect(signal.aborted).toBe(true)
    resolve([[0.1, 0.9]])
    await flush()
    expect(get(source)).toEqual({})
    source.destroy()
})
