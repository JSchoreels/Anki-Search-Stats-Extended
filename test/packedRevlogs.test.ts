import type { Revlog } from "../src/ts/cardData"
import { packRevlogs, unpackRevlogs } from "../src/ts/packedRevlogs"

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
    expect(unpackRevlogs(delivered)).toEqual(reviews)
    expect(unpackRevlogs(packRevlogs([]))).toEqual([])
})
