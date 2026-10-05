import { EMPTY_CALIBRATION_SAMPLES } from "../src/ts/calibrationSamples"
import { intervalHistogram, type CardData } from "../src/ts/cardData"
import { latestResult } from "../src/ts/latestResult"
import { runStatsTask } from "../src/ts/statsWorkerClient"

test("intervals include review and relearning cards and only explicitly omit suspended cards", () => {
    const cards = [
        { type: 2, queue: 2, ivl: 10 },
        { type: 3, queue: -2, ivl: 10 },
        { type: 2, queue: -1, ivl: 30 },
        { type: 0, queue: 0, ivl: 0 },
        { type: 1, queue: 1, ivl: 1 },
    ] as CardData[]
    expect(intervalHistogram(cards, false)).toEqual({ 10: 2 })
    expect(intervalHistogram(cards, true)).toEqual({ 10: 2, 30: 1 })
})

test("a superseded request cannot replace a newer result", async () => {
    const values: string[] = []
    let finishOld!: (value: string) => void
    const stop = latestResult<string>(
        (v) => values.push(v),
        () =>
            new Promise((resolve) => {
                finishOld = resolve
            })
    )
    stop()
    latestResult(
        (v: string) => values.push(v),
        async () => "new"
    )
    await Promise.resolve()
    finishOld("old")
    await Promise.resolve()
    expect(values).toEqual(["new"])
})

test("a cancelled worker stops computing and cannot publish its result", async () => {
    const worker = { terminate: jest.fn(), postMessage: jest.fn(), onmessage: null as any }
    const original = global.Worker
    global.Worker = jest.fn(() => worker) as any
    try {
        const controller = new AbortController()
        const promise = runStatsTask(
            "calibrationReplay",
            [EMPTY_CALIBRATION_SAMPLES, new Float64Array(0)],
            controller.signal
        )
        const result = expect(promise).rejects.toMatchObject({ name: "AbortError" })
        controller.abort()
        worker.onmessage({ data: { result: ["stale"] } })
        await result
        expect(worker.terminate).toHaveBeenCalled()
    } finally {
        global.Worker = original
    }
})

test("current worker failures are reported, cancelled request failures are silent", async () => {
    const alertMock = jest.spyOn(global, "alert").mockImplementation(() => undefined)
    const logMock = jest.spyOn(console, "error").mockImplementation(() => undefined)
    try {
        const stop = latestResult(
            () => undefined,
            async () => {
                throw new Error("obsolete")
            }
        )
        stop()
        latestResult(
            () => undefined,
            async () => {
                throw new Error("worker failed")
            }
        )
        await Promise.resolve()
        expect(alertMock).toHaveBeenCalledTimes(1)
        expect(alertMock).toHaveBeenCalledWith("Search Stats Extended: worker failed")
    } finally {
        alertMock.mockRestore()
        logMock.mockRestore()
    }
})
