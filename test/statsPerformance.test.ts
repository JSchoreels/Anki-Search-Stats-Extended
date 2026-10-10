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

test.each(["revlog", "memorised", "calibrationSamples"] as const)(
    "%s transfers numeric history while preserving the page's reviews",
    async (task) => {
        const worker = { terminate: jest.fn(), postMessage: jest.fn(), onmessage: null as any }
        const original = global.Worker
        global.Worker = jest.fn(() => worker) as any
        const review = {
            id: 1700000000001,
            cid: 1700000000000,
            ease: 3,
            ivl: -60,
            lastIvl: 10,
            time: 1000,
            factor: 2500,
            type: 0,
        }
        const reviews = [review]
        try {
            const result = runStatsTask(task, [reviews] as never, new AbortController().signal)
            await Promise.resolve()
            const [message, transfers] = worker.postMessage.mock.calls[0]
            expect(message.task).toBe(task)
            expect(message.args[0]).toBeInstanceOf(Float64Array)
            expect(Array.from(message.args[0])).toEqual([
                1700000000001, 1700000000000, 3, -60, 10, 1000, 2500, 0,
            ])
            expect(transfers).toEqual([message.args[0].buffer])
            expect(reviews).toEqual([review])
            worker.onmessage({ data: { result: "finished" } })
            expect(await result).toBe("finished")
            for (let i = 0; i < 5; i++) await Promise.resolve()
        } finally {
            global.Worker = original
        }
    }
)
