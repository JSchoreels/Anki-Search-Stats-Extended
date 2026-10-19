const flush = async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve()
}

test("visible matrix requests lifetime history, caches threshold edits, and cancels/disposes obsolete work", async () => {
    jest.resetModules()
    const previousFetch = global.fetch
    const histories: { dispose: jest.Mock }[] = []
    const loads: { cids: number[]; days: number; signal: AbortSignal }[] = []
    const calculations: { resolve: (value: unknown) => void; signal: AbortSignal }[] = []
    const requests: string[] = []
    global.fetch = jest.fn(async (url: string, options) => {
        requests.push(url)
        const value = url.endsWith("cardData")
            ? {
                  columns: ["id"],
                  data: JSON.parse(options!.body as string).map((id: number) => [id]),
              }
            : url.endsWith("fsrsPresetData")
              ? { presets: [], cards: {}, retrievability: {} }
              : {}
        return { ok: true, text: async () => JSON.stringify(value) }
    }) as typeof fetch
    jest.doMock("../src/ts/statsWorkerClient", () => ({
        loadStatsHistory: async (cids: number[], days: number, signal: AbortSignal) => {
            loads.push({ cids, days, signal })
            const history = { dispose: jest.fn() }
            histories.push(history)
            return history
        },
        runStatsTask: (task: string, args: unknown[], signal: AbortSignal) => {
            expect(task).toBe("activeRetrievability")
            return new Promise((resolve, reject) => {
                calculations.push({ resolve, signal })
                signal.addEventListener(
                    "abort",
                    () => reject(new DOMException("Cancelled", "AbortError")),
                    { once: true }
                )
            })
        },
    }))
    let unsubscribe = () => {}
    try {
        const stores = await import("../src/ts/stores")
        stores.shownCategories.set({ misc: false, lapse: false })
        const values: unknown[] = []
        unsubscribe = stores.activeRetrievabilityHistory.subscribe((v) => {
            if (v) values.push(v)
        })
        stores.cids.set([1])
        stores.graphsRequest.set({ days: 30 } as any)
        await flush()
        expect(loads).toHaveLength(0)
        expect(requests.filter((url) => url.endsWith("fsrsPresetData"))).toHaveLength(0)
        stores.activeRetrievabilityRequested.set(true)
        await flush()
        expect(loads).toHaveLength(1)
        expect(loads[0]).toMatchObject({ cids: [1], days: 0 })
        const result = { cards: [], excluded: 0, incomplete: 1 }
        calculations[0].resolve(result)
        await flush()
        expect(histories[0].dispose).toHaveBeenCalledTimes(1)
        expect(values).toEqual([result])
        stores.activeRetrievabilitySettings.set({
            daysLower: 10,
            daysUpper: 20,
            rLower: 70,
            rUpper: 95,
        })
        stores.graphsRequest.set({ days: 365 } as any)
        await flush()
        expect(loads).toHaveLength(1)
        stores.cids.set([2])
        await flush()
        expect(loads).toHaveLength(2)
        stores.activeRetrievabilityRequested.set(false)
        await flush()
        expect(calculations[1].signal.aborted).toBe(true)
        expect(histories[1].dispose).toHaveBeenCalledTimes(1)
        calculations[1].resolve({ cards: [{ id: 2 }] })
        await flush()
        expect(values).toEqual([result])
        stores.activeRetrievabilityRequested.set(true)
        await flush()
        expect(loads).toHaveLength(3)
        unsubscribe()
        await flush()
        expect(calculations[2].signal.aborted).toBe(true)
        expect(histories[2].dispose).toHaveBeenCalledTimes(1)
        stores.activeRetrievabilityRequested.set(false)
        stores.cids.set(null)
    } finally {
        unsubscribe()
        global.fetch = previousFetch
        jest.dontMock("../src/ts/statsWorkerClient")
        jest.resetModules()
    }
})
