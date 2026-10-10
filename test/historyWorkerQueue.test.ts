import { scheduleHistoryTask } from "../src/ts/historyWorkerQueue"

// Advance both the task-resolution chain and the next queued microtask.
async function flush() {
    for (let i = 0; i < 5; i++) await Promise.resolve()
}

test("history workers run one at a time, with calibration first", async () => {
    const signal = new AbortController().signal
    const started: string[] = []
    let complete!: () => void
    const memorised = scheduleHistoryTask(2, signal, async () => {
        started.push("memorised")
        return 2
    })
    const revlog = scheduleHistoryTask(1, signal, async () => {
        started.push("revlog")
        return 1
    })
    const calibration = scheduleHistoryTask(
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
    const first = scheduleHistoryTask(
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
    const cancelled = scheduleHistoryTask(0, controller.signal, start)
    const rejected = expect(cancelled).rejects.toMatchObject({ name: "AbortError" })
    controller.abort()
    await rejected
    const failure = scheduleHistoryTask(1, signal, async () => {
        throw new Error("worker failed")
    })
    const failed = expect(failure).rejects.toThrow("worker failed")
    const next = scheduleHistoryTask(2, signal, async () => "ready")
    complete()
    await first
    await failed
    expect(await next).toBe("ready")
    expect(start).not.toHaveBeenCalled()
    await flush()
})
