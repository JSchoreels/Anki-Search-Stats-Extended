test("history stores abort old searches and day ranges, reject stale loads and dispose on close", async () => {
    jest.resetModules()
    const requests: {
        signal: AbortSignal
        cids: number[]
        days: number
        resolve: (value: any) => void
    }[] = []
    jest.doMock("../src/ts/statsWorkerClient", () => ({
        loadStatsHistory: (cids: number[], days: number, signal: AbortSignal) =>
            new Promise((resolve) => requests.push({ cids, days, signal, resolve })),
        runStatsTask: () => new Promise(() => {}),
    }))
    const { get } = await import("svelte/store")
    const stores = await import("../src/ts/stores")
    const published: any[] = []
    const unsubscribe = stores.revlogs.subscribe((value) => published.push(value))
    const flush = async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve()
    }
    try {
        stores.cids.set([1])
        stores.showRevlogStats.set(true)
        expect(requests).toHaveLength(1)
        stores.graphsRequest.set({ days: 30 } as any)
        expect(requests[0].signal.aborted).toBe(true)
        expect(requests[1]).toMatchObject({ cids: [1], days: 30 })
        stores.cids.set([2])
        stores.showRevlogStats.set(true)
        expect(requests[1].signal.aborted).toBe(true)
        expect(requests[2]).toMatchObject({ cids: [2], days: 30 })
        const current = { length: 0, lastForget: [] }
        requests[2].resolve(current)
        await flush()
        expect(get(stores.revlogs)).toBe(current)
        requests[0].resolve({ length: 100 })
        requests[1].resolve({ length: 200 })
        await flush()
        expect(published.filter(Boolean)).toEqual([current])
        stores.cids.set(null)
        expect(requests[2].signal.aborted).toBe(true)
        expect(get(stores.revlogs)).toBeNull()
    } finally {
        stores.cids.set(null)
        unsubscribe()
        jest.dontMock("../src/ts/statsWorkerClient")
        jest.resetModules()
    }
})
