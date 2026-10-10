import { scheduleStatsTask } from "../src/ts/statsWorkerQueue"

// Advance both the task-resolution chain and the next queued microtask.
async function flush() {
    for (let i = 0; i < 5; i++) await Promise.resolve()
}

test("stats workers run one at a time, with calibration first", async () => {
    const signal = new AbortController().signal
    const started: string[] = []
    let complete!: () => void
    const memorised = scheduleStatsTask(2, signal, async () => {
        started.push("memorised")
        return 2
    })
    const revlog = scheduleStatsTask(1, signal, async () => {
        started.push("revlog")
        return 1
    })
    const calibration = scheduleStatsTask(
        0,
        signal,
        () =>
            new Promise<number>((resolve) => {
                started.push("calibration")
                complete = () => resolve(0)
            })
    )
    await flush()
    expect(started).toEqual(["calibration"])
    complete()
    expect(await Promise.all([calibration, revlog, memorised])).toEqual([0, 1, 2])
    expect(started).toEqual(["calibration", "revlog", "memorised"])
    await flush()
})

test("a cancelled queued search never starts, and failures release the slot", async () => {
    const signal = new AbortController().signal
    let complete!: () => void
    const first = scheduleStatsTask(
        0,
        signal,
        () =>
            new Promise<void>((resolve) => {
                complete = resolve
            })
    )
    await flush()
    const controller = new AbortController()
    const start = jest.fn()
    const cancelled = scheduleStatsTask(0, controller.signal, start)
    const rejected = expect(cancelled).rejects.toMatchObject({ name: "AbortError" })
    controller.abort()
    await rejected
    const failure = scheduleStatsTask(1, signal, async () => {
        throw new Error("worker failed")
    })
    const failed = expect(failure).rejects.toThrow("worker failed")
    const next = scheduleStatsTask(2, signal, async () => "ready")
    complete()
    await first
    await failed
    expect(await next).toBe("ready")
    expect(start).not.toHaveBeenCalled()
    await flush()
})
