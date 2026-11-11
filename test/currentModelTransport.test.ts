test("current model predictions release the background job after reading the result", async () => {
    const originalFetch = global.fetch
    const responses: Record<string, unknown> = {
        startCurrentRwkvModel: { jobId: 42, phase: "complete", done: true },
        currentRwkvModelPredictions: { data: [[7, 0.8]] },
        cancelCurrentRwkvModel: {},
    }
    const fetchMock = jest.fn(async (url: string) => {
        const body = responses[url.split("/").pop()!]
        return { ok: true, json: async () => body, text: async () => JSON.stringify(body) }
    })
    jest.resetModules()
    global.fetch = fetchMock as typeof fetch
    try {
        const { getCurrentRwkvModelPredictions } = await import("../src/ts/search")
        const progress = jest.fn()
        await expect(
            getCurrentRwkvModelPredictions("rwkv-big", [7], new AbortController().signal, progress)
        ).resolves.toEqual([[7, 0.8]])
        expect(progress).toHaveBeenCalledWith({ jobId: 42, phase: "complete", done: true })
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            "/_anki/startCurrentRwkvModel",
            "/_anki/currentRwkvModelPredictions",
            "/_anki/cancelCurrentRwkvModel",
        ])
    } finally {
        global.fetch = originalFetch
        jest.resetModules()
    }
})

test("a selection cancelled while its start request is in flight still releases the job", async () => {
    const originalFetch = global.fetch
    let resolveStart!: (value: unknown) => void
    const fetchMock = jest.fn(async (url: string) => {
        if (url.endsWith("startCurrentRwkvModel"))
            return await new Promise((resolve) => (resolveStart = resolve))
        return { ok: true, text: async () => "{}" }
    })
    jest.resetModules()
    global.fetch = fetchMock as typeof fetch
    try {
        const { getCurrentRwkvModelPredictions } = await import("../src/ts/search")
        const controller = new AbortController()
        const result = getCurrentRwkvModelPredictions("rwkv-big", [7], controller.signal, () => {})
        controller.abort()
        resolveStart({ ok: true, json: async () => ({ jobId: 17, phase: "waiting", done: false }) })
        await expect(result).rejects.toMatchObject({ name: "AbortError" })
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            "/_anki/startCurrentRwkvModel",
            "/_anki/cancelCurrentRwkvModel",
        ])
    } finally {
        global.fetch = originalFetch
        jest.resetModules()
    }
})
