import type { Revlog } from "../src/ts/cardData"
import { packRevlogs, RevlogHistory } from "../src/ts/packedRevlogs"
import { loadRevlogPages } from "../src/ts/revlogPages"
import { resultTransfers } from "../src/ts/workerTransfers"
import { reviewSnapshot } from "./reviewSnapshot"

const columns = ["id", "cid", "ease", "ivl", "lastIvl", "time", "factor", "type"]

test("compact native history preserves integer boundaries, timestamp IDs and every transferred column", async () => {
    const rows = [
        [
            Number.MAX_SAFE_INTEGER,
            1730212469023,
            255,
            -2147483648,
            2147483647,
            4294967295,
            4294967295,
            255,
        ],
        [1791659375463, 1730212469024, 0, -60, 36500, 0, 0, 4],
    ]
    const history = await loadRevlogPages(async () => ({ columns, data: rows }))
    expect(history.byteLength).toBe(2 * 34)
    const expected = rows.map((row) => Object.fromEntries(columns.map((key, i) => [key, row[i]])))
    expect(Array.from(history, reviewSnapshot)).toEqual(expected)
    const transfers = resultTransfers(history.values)
    expect(transfers).toHaveLength(8)
    const received = structuredClone(history.values, { transfer: transfers })
    expect(history.byteLength).toBe(0)
    const delivered = new RevlogHistory(received)
    expect(delivered.length).toBe(2)
    expect(delivered.byteLength).toBe(68)
    expect(Array.from(delivered, reviewSnapshot)).toEqual(expected)
    const empty = await loadRevlogPages(async () => ({ columns, data: [] }))
    expect(Array.from(empty)).toEqual([])
    expect(empty.byteLength).toBe(0)
})

test.each([
    ["ease", 256],
    ["type", -1],
    ["ivl", 2147483648],
    ["lastIvl", -2147483649],
    ["time", -1],
    ["factor", 4294967296],
    ["time", 1.5],
])(
    "native history rejects %s=%s instead of silently truncating or wrapping",
    async (field, value) => {
        const row = [1791659375463, 1730212469023, 3, -60, 1, 1000, 2500, 1]
        row[columns.indexOf(field as string)] = value as number
        await expect(loadRevlogPages(async () => ({ columns, data: [row] }))).rejects.toThrow(
            `Invalid review-history ${field}`
        )
    }
)

test("transferred review columns preserve timestamp IDs, negative intervals, resets and all grades", () => {
    const reviews = [0, 1, 2, 3, 4].map((ease, i) => ({
        id: 1791659375463 + i,
        cid: 1730212469023,
        ease,
        ivl: -60,
        lastIvl: 36500,
        time: 300001,
        factor: ease === 0 ? 0 : 2000,
        type: ease === 0 ? 4 : 1,
    })) as Revlog[]
    const packed = packRevlogs(reviews)
    const delivered = structuredClone(packed, { transfer: [packed.buffer] })
    expect(packed.byteLength).toBe(0)
    expect(Array.from(new RevlogHistory(delivered), reviewSnapshot)).toEqual(reviews)
    expect(Array.from(new RevlogHistory(packRevlogs([])), reviewSnapshot)).toEqual([])
})
