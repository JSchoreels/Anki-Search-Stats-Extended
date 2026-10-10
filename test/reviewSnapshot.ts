import type { Revlog } from "../src/ts/cardData"

export function reviewSnapshot(row: Revlog): Revlog {
    const { id, cid, ease, ivl, lastIvl, time, factor, type } = row
    return { id, cid, ease, ivl, lastIvl, time, factor, type }
}
