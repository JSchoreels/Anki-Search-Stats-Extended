import { StatsHistory, loadStatsHistory } from "../src/ts/statsHistory"
import { runStatsTask } from "../src/ts/statsWorkerClient"

class FakeWorker {
    static instances: FakeWorker[] = []
    messages: any[] = []
    transfers: Transferable[][] = []
    onmessage: ((event: { data: any }) => void) | undefined
    onerror: ((event: { message: string }) => void) | undefined
    onmessageerror: (() => void) | undefined
    terminate = jest.fn()
    constructor() {
        FakeWorker.instances.push(this)
    }
    postMessage(message: any, transfer: Transferable[] = []) {
        this.transfers.push(transfer)
        this.messages.push(structuredClone(message, { transfer }))
    }
    send(data: any) {
        this.onmessage?.({ data })
    }
}

const originalWorker = global.Worker
const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
}
let lifetime: AbortController
let history: StatsHistory
beforeEach(async () => {
    FakeWorker.instances = []
    global.Worker = FakeWorker as any
    lifetime = new AbortController()
    history = new StatsHistory(lifetime.signal)
    const loaded = history.load([1730212469023], 365)
    const lastForget: number[] = []
    lastForget[1730212469023] = 1791659375463
    FakeWorker.instances[0].send({
        result: { length: 20, lastForget: structuredClone(lastForget) },
    })
    await loaded
})
afterEach(async () => {
    history.dispose()
    lifetime.abort()
    await flush()
    global.Worker = originalWorker
})
const task = (signal = new AbortController().signal) =>
    runStatsTask("calibrationSamples", [history, [], [], []] as any, signal)
function complete(worker: FakeWorker, result: any = "done", error?: string) {
    const values = new Float64Array([1791659375463, 1730212469023, 3, -60, 1, 1000, 2500, 1])
    worker.send({ result, error, historyValues: values })
    expect(values.byteLength).toBe(0)
}

test("the page holds metadata; task completion transfers one buffer to a fresh worker", async () => {
    expect(history.length).toBe(20)
    expect(history.lastForget[1730212469023]).toBe(1791659375463)
    expect((history as any).values).toBeUndefined()
    const first = FakeWorker.instances[0]
    const calculation = task()
    await flush()
    expect(first.messages[1]).toMatchObject({
        task: "calibrationSamples",
        useHistory: true,
        args: [undefined, [], [], []],
    })
    const result = { revlogIds: new Float64Array([1791659375463]) }
    complete(first, result)
    await expect(calculation).resolves.toBe(result)
    const next = FakeWorker.instances[1]
    expect(first.terminate).toHaveBeenCalledTimes(1)
    expect(next.messages[0].action).toBe("adoptHistory")
    expect(next.messages[0].values[1]).toBe(1730212469023)
    expect(next.transfers[0]).toHaveLength(1)
    const repeated = task()
    await flush()
    expect(next.messages[1].useHistory).toBe(true)
    complete(next)
    await expect(repeated).resolves.toBe("done")
    first.send({ result: "obsolete" })
    expect(FakeWorker.instances).toHaveLength(3)
})

test("a cancelled active graph rejects immediately but holds the queue until history returns", async () => {
    const cancelled = new AbortController()
    const active = task(cancelled.signal)
    const rejected = expect(active).rejects.toMatchObject({ name: "AbortError" })
    await flush()
    const queued = task()
    cancelled.abort()
    await rejected
    await flush()
    expect(FakeWorker.instances[0].messages).toHaveLength(2)
    expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled()
    complete(FakeWorker.instances[0], "discarded")
    await flush()
    expect(FakeWorker.instances[1].messages[1].task).toBe("calibrationSamples")
    complete(FakeWorker.instances[1], "next")
    await expect(queued).resolves.toBe("next")
})

test("cancelling a queued graph never sends it to the history worker", async () => {
    const active = task()
    await flush()
    const cancelled = new AbortController()
    const queued = task(cancelled.signal)
    const rejected = expect(queued).rejects.toMatchObject({ name: "AbortError" })
    cancelled.abort()
    await rejected
    complete(FakeWorker.instances[0])
    await active
    await flush()
    expect(FakeWorker.instances[1].messages).toHaveLength(1)
})

test("search cancellation terminates the owner and releases the queue without returning history", async () => {
    const active = task()
    const rejected = expect(active).rejects.toMatchObject({ name: "AbortError" })
    await flush()
    lifetime.abort()
    await rejected
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
    const independent = runStatsTask(
        "comparison",
        [null, null, null] as any,
        new AbortController().signal
    )
    await flush()
    FakeWorker.instances[1].send({ result: "independent" })
    await expect(independent).resolves.toBe("independent")
    await expect(task()).rejects.toMatchObject({ name: "AbortError" })
})

test("calculator errors rotate the history and allow a later calculation", async () => {
    const failure = task()
    const rejected = expect(failure).rejects.toThrow("calculator failed")
    await flush()
    complete(FakeWorker.instances[0], undefined, "calculator failed")
    await rejected
    const retry = task()
    await flush()
    complete(FakeWorker.instances[1])
    await expect(retry).resolves.toBe("done")
})

test.each(["onerror", "onmessageerror"])(
    "fatal %s disposes the owner and rejects its pending calculation",
    async (event) => {
        const active = task()
        const rejected = expect(active).rejects.toThrow(/worker/i)
        await flush()
        if (event === "onerror") FakeWorker.instances[0].onerror?.({ message: "worker crashed" })
        else FakeWorker.instances[0].onmessageerror?.()
        await rejected
        expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
        await expect(task()).rejects.toThrow(/worker/i)
    }
)

test("failed ownership transfer disposes both workers and rejects instead of losing a pending promise", async () => {
    const active = task()
    const rejected = expect(active).rejects.toThrow("transfer failed")
    await flush()
    const original = FakeWorker.prototype.postMessage
    FakeWorker.prototype.postMessage = () => {
        throw new Error("transfer failed")
    }
    try {
        FakeWorker.instances[0].send({ historyValues: new Float64Array(8), result: "done" })
    } finally {
        FakeWorker.prototype.postMessage = original
    }
    await rejected
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
    expect(FakeWorker.instances[1].terminate).toHaveBeenCalledTimes(1)
})

test("cancelling initial history loading terminates its worker and an already cancelled load creates none", async () => {
    const controller = new AbortController()
    const loading = loadStatsHistory([], 0, controller.signal)
    const rejected = expect(loading).rejects.toMatchObject({ name: "AbortError" })
    controller.abort()
    await rejected
    expect(FakeWorker.instances[1].terminate).toHaveBeenCalledTimes(1)
    await expect(loadStatsHistory([], 0, controller.signal)).rejects.toMatchObject({
        name: "AbortError",
    })
    expect(FakeWorker.instances).toHaveLength(2)
})
