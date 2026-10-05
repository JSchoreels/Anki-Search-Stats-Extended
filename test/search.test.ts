import { uniqueRevlogCids } from "../src/ts/search"

test("compact presets expand to each card's complete resolved settings", async () => {
    const originalFetch = global.fetch
    // Same preset id, distinct card-specific settings must remain distinct.
    const presets = [
        { id: "shared", desiredRetention: 0.9 },
        { id: "shared", desiredRetention: 0.8 },
    ]
    jest.resetModules()
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () =>
            JSON.stringify({ presets, cards: { 1: 0, 2: 1, 3: 0 }, retrievability: { 1: 0.87 } }),
    })
    try {
        const { getFsrsPresetData } = await import("../src/ts/search")
        expect(await getFsrsPresetData([1, 2, 3])).toEqual({
            presetsByCard: { 1: presets[0], 2: presets[1], 3: presets[0] },
            retrievability: { 1: 0.87 },
        })
        expect(await getFsrsPresetData([])).toEqual({ presetsByCard: {}, retrievability: {} })
    } finally {
        global.fetch = originalFetch
        jest.resetModules()
    }
})

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
            roles: [],
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
            roles: [],
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
        text: async () => JSON.stringify({ column: "cache", data: [[321, "0.62"]], roles: ["post_optimization", null, 123] }),
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
            roles: ["post_optimization"],
        })
    } finally {
        global.fetch = originalFetch
        jest.resetModules()
    }
})

test("RWKV Memorised endpoints send the selected card ids", async () => {
    const originalFetch = global.fetch
    const progress = {
        phase: "computing",
        current: 10,
        total: 100,
        done: false,
    }
    const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify(progress),
    })

    jest.resetModules()
    global.fetch = fetchMock as typeof fetch
    try {
        const {
            cancelRwkvMemorisedHistory,
            getRwkvMemorisedHistoryProgress,
            startRwkvMemorisedHistory,
        } = await import("../src/ts/search")

        await expect(startRwkvMemorisedHistory([10, 11])).resolves.toEqual(progress)
        await expect(getRwkvMemorisedHistoryProgress([10, 11])).resolves.toEqual(progress)
        await cancelRwkvMemorisedHistory()

        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            "/_anki/startRwkvMemorisedHistory",
            expect.objectContaining({ body: JSON.stringify({ cids: [10, 11] }) })
        )
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            "/_anki/rwkvMemorisedHistoryProgress",
            expect.objectContaining({ body: JSON.stringify({ cids: [10, 11] }) })
        )
        expect(fetchMock).toHaveBeenNthCalledWith(
            3,
            "/_anki/cancelRwkvMemorisedHistory",
            expect.objectContaining({ body: "{}" })
        )
    } finally {
        global.fetch = originalFetch
        jest.resetModules()
    }
})
