import { GraphsRequest, GraphsResponse } from "../src/ts/proto/anki/stats_pb"

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

test.each([false, true])(
    "one graph request per required history range (all-time=%s)",
    async (allTime) => {
        jest.resetModules()
        const previous = global.fetch
        const requests: { search: string; days: number }[] = []
        global.fetch = jest.fn(async (url, options) => {
            if (url === "/_anki/graphs") {
                const request = GraphsRequest.fromBinary(options!.body as Uint8Array)
                requests.push({ search: request.search, days: request.days })
                return new Response(new GraphsResponse().toBinary())
            }
            return new Response(url === "/_anki/cardSearch" ? "[]" : '{"columns":[],"data":[]}')
        }) as typeof fetch
        try {
            const { alwaysAllTime } = await import("../src/ts/stores")
            alwaysAllTime.set(allTime)
            const { patchFetch } = await import("../src/ts/root")
            patchFetch()
            await fetch("/_anki/graphs", {
                body: new GraphsRequest({ search: "deck:A", days: 365 }).toBinary(),
            })
            await flush()
            expect(requests).toEqual(
                allTime
                    ? [
                          { search: "deck:A", days: 365 },
                          { search: "deck:A", days: 0 },
                      ]
                    : [{ search: "deck:A", days: 365 }]
            )
        } finally {
            global.fetch = previous
            jest.resetModules()
        }
    }
)

test.each(["deck:A", "prop:rwkv:r<0.9"])(
    "pending retries preserve only score-independent SSE data: %s",
    async (search) => {
        jest.resetModules()
        const previous = global.fetch
        let pending = true
        let searches = 0
        global.fetch = jest.fn(async (url) => {
            if (url === "/_anki/graphs")
                return new Response(new GraphsResponse().toBinary(), {
                    headers: pending ? { "X-Anki-Rwkv-Stats-Pending": "1" } : {},
                })
            if (url === "/_anki/cardSearch") searches++
            return new Response(url === "/_anki/cardSearch" ? "[]" : '{"columns":[],"data":[]}')
        }) as typeof fetch
        try {
            const { patchFetch } = await import("../src/ts/root")
            patchFetch()
            const request = () =>
                fetch("/_anki/graphs", {
                    body: new GraphsRequest({ search, days: 365 }).toBinary(),
                })
            await request()
            await flush()
            pending = false
            await request()
            await flush()
            expect(searches).toBe(search === "deck:A" ? 1 : 2)
            // A subsequent ordinary refresh must not use the pending retry cache.
            await request()
            await flush()
            expect(searches).toBe(search === "deck:A" ? 2 : 3)
        } finally {
            global.fetch = previous
            jest.resetModules()
        }
    }
)

test("card data from an old search cannot overwrite the new search", async () => {
    jest.resetModules()
    const previous = global.fetch
    const responses: ((response: Response) => void)[] = []
    global.fetch = jest.fn(() => new Promise<Response>((resolve) => responses.push(resolve)))
    let unsubscribe = () => {}
    try {
        const { cids, card_data } = await import("../src/ts/stores")
        const applied: number[][] = []
        unsubscribe = card_data.subscribe((cards) => {
            if (cards) applied.push(cards.map((card) => card.id))
        })
        cids.set([1])
        cids.set([2])
        responses[1](new Response('{"columns":["id"],"data":[[2]]}'))
        await flush()
        responses[0](new Response('{"columns":["id"],"data":[[1]]}'))
        await flush()
        expect(applied).toEqual([[2]])
        cids.set(null)
    } finally {
        unsubscribe()
        global.fetch = previous
        jest.resetModules()
    }
})
