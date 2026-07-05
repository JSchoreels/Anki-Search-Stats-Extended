import { uniqueRevlogCids } from "../src/ts/search"

test("uniqueRevlogCids returns reviewed card ids once in first-seen order", () => {
    expect(
        uniqueRevlogCids([{ cid: 3 }, { cid: 1 }, { cid: 3 }, { cid: 2 }, { cid: 1 }])
    ).toStrictEqual([3, 1, 2])
})

test("getRwkvReviewRetrievability sends calibration revlog ids", async () => {
    const originalFetch = global.fetch
    const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ column: "cache", data: [[123, "0.42"]] }),
    })

    jest.resetModules()
    global.fetch = fetchMock as typeof fetch
    try {
        const { getRwkvReviewRetrievability } = await import("../src/ts/search")
        const result = await getRwkvReviewRetrievability([10, 11], 365, [123, 456, 123])

        expect(fetchMock).toHaveBeenCalledWith(
            "/_anki/rwkvReviewRetrievability",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    cids: [10, 11],
                    day_range: 365,
                    revlog_ids: [123, 456],
                }),
            })
        )
        expect(result).toEqual({
            column: "cache",
            predictionsByRevlogId: { 123: 0.42 },
            warnings: [],
        })
    } finally {
        global.fetch = originalFetch
        jest.resetModules()
    }
})

test("getRwkvReviewRetrievability reports endpoint warnings", async () => {
    const originalFetch = global.fetch
    const warnMock = jest.spyOn(console, "warn").mockImplementation(() => undefined)
    const warning = "RWKV calibration ignored 2 non-answer revlog row(s)."
    const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        text: async () =>
            JSON.stringify({
                column: "cache",
                data: [[123, 0.42]],
                warnings: [warning],
            }),
    })

    jest.resetModules()
    global.fetch = fetchMock as typeof fetch
    try {
        const { getRwkvReviewRetrievability } = await import("../src/ts/search")
        const result = await getRwkvReviewRetrievability([10], 365, [123])

        expect(result).toEqual({
            column: "cache",
            predictionsByRevlogId: { 123: 0.42 },
            warnings: [warning],
        })
        expect(warnMock).toHaveBeenCalledWith("Search Stats Extended:", warning)
    } finally {
        global.fetch = originalFetch
        warnMock.mockRestore()
        jest.resetModules()
    }
})

test("getFsrsReviewRetrievability sends calibration revlog ids", async () => {
    const originalFetch = global.fetch
    const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ column: "cache", data: [[321, "0.62"]] }),
    })

    jest.resetModules()
    global.fetch = fetchMock as typeof fetch
    try {
        const { getFsrsReviewRetrievability } = await import("../src/ts/search")
        const result = await getFsrsReviewRetrievability([20, 21], 365, [321, 654, 321])

        expect(fetchMock).toHaveBeenCalledWith(
            "/_anki/fsrsReviewRetrievability",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    cids: [20, 21],
                    day_range: 365,
                    revlog_ids: [321, 654],
                }),
            })
        )
        expect(result).toEqual({
            column: "cache",
            predictionsByRevlogId: { 321: 0.62 },
            warnings: [],
        })
    } finally {
        global.fetch = originalFetch
        jest.resetModules()
    }
})
