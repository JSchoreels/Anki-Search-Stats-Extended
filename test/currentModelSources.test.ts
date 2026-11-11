import { get } from "svelte/store"
import { createCurrentModelSources } from "../src/ts/currentModelSources"
import { getCurrentRwkvModelPredictions } from "../src/ts/search"

jest.mock("../src/ts/search", () => ({ getCurrentRwkvModelPredictions: jest.fn() }))

const request = getCurrentRwkvModelPredictions as jest.MockedFunction<
    typeof getCurrentRwkvModelPredictions
>
const flush = async () => {
    for (let index = 0; index < 20; index++) await Promise.resolve()
}

beforeEach(() => {
    request.mockReset()
    request.mockResolvedValue([[1, 0.8]])
})

test("only selected current models are prepared and completed scores are reused", async () => {
    const sources = createCurrentModelSources()
    sources.setCards([1, 2])
    sources.select(["rwkv-big", "rwkv-big"])
    sources.select(["rwkv-big"])
    await flush()
    expect(request).toHaveBeenCalledTimes(1)
    expect(get(sources)["rwkv-big"]).toMatchObject({ phase: "ready", scores: [[1, 0.8]] })
    sources.select([])
    sources.select(["rwkv-big", "rwkv-small-curve"])
    await flush()
    expect(request.mock.calls.map(([model]) => model)).toEqual(["rwkv-big", "rwkv-small-curve"])
    sources.destroy()
})

test("deselection and search changes cancel obsolete jobs and suppress stale scores", async () => {
    let resolve!: (scores: [number, number][]) => void
    request.mockReturnValueOnce(new Promise((done) => (resolve = done)))
    const sources = createCurrentModelSources()
    sources.setCards([1])
    sources.select(["rwkv-big"])
    const oldSignal = request.mock.calls[0][2]
    sources.select(["rwkv-small-instant"])
    expect(oldSignal.aborted).toBe(true)
    resolve([[1, 0.9]])
    await flush()
    expect(get(sources)["rwkv-big"]).toBeUndefined()
    expect(get(sources)["rwkv-small-instant"]?.phase).toBe("ready")

    request.mockReturnValueOnce(new Promise(() => {}))
    sources.select(["rwkv-tiny-instant"])
    const searchSignal = request.mock.calls[2][2]
    sources.setCards([2])
    expect(searchSignal.aborted).toBe(true)
    expect(get(sources)).toEqual({})
    sources.destroy()
})

test("a failed replay can be retried", async () => {
    request.mockRejectedValueOnce(new Error("weights missing"))
    const sources = createCurrentModelSources()
    sources.setCards([1])
    sources.select(["rwkv-big"])
    await flush()
    expect(get(sources)["rwkv-big"]).toMatchObject({ phase: "failed", error: "weights missing" })
    sources.retry("rwkv-big")
    await flush()
    expect(get(sources)["rwkv-big"]?.phase).toBe("ready")
    sources.destroy()
})
