import { FSRS6_DEFAULT_WEIGHTS } from "ts-fsrs/models/fsrs-6"
import { FSRS7_DEFAULT_WEIGHTS } from "ts-fsrs/models/fsrs-7"
import type { Revlog } from "../src/ts/cardData"
import type { ResolvedFsrsPreset } from "../src/ts/config"
import { prepareFsrsReplay } from "../src/ts/fsrsHistory"
import { packRevlogs, RevlogHistory } from "../src/ts/packedRevlogs"
import { loadRevlogPages } from "../src/ts/revlogPages"
import { prepareFsrsReplay as referenceReplay } from "./reference/fsrsReplay"
import { reviewSnapshot } from "./reviewSnapshot"

const day = 86400000,
    start = Date.UTC(2026, 8, 1)
const sources = [FSRS6_DEFAULT_WEIGHTS, FSRS7_DEFAULT_WEIGHTS].map(
    (params, i) =>
        ({
            params: [...params],
            fsrsVersion: i === 0 ? "six" : "seven",
            historicalRetention: 0.85,
            ignoreRevlogsBeforeDate: "2026-09-03",
        }) as ResolvedFsrsPreset
)
const source = (cid: number) => (cid === 4 ? undefined : sources[cid % 2])
const snapshot = (step: {
    review: Revlog
    model: unknown
    reset: boolean
    startingState?: unknown
}) => ({
    review: reviewSnapshot(step.review),
    model: step.model,
    reset: step.reset,
    startingState: step.startingState,
})

test.each(["ordered", "shuffled", "duplicate timestamps"])(
    "packed replay matches previous selection, bridges, resets and order for %s history",
    async (order) => {
        const reviews: Revlog[] = []
        for (let cid = 1; cid <= 4; cid++) {
            for (let i = 0; i < 80; i++) {
                const reset = i % 17 === 5,
                    cram = i % 13 === 7,
                    manual = i % 19 === 9
                reviews.push({
                    id: start + i * day + (order === "duplicate timestamps" ? 0 : cid),
                    cid,
                    ease: reset || manual ? 0 : (((i % 4) + 1) as Revlog["ease"]),
                    type: reset ? 4 : cram ? 3 : i % 11 < 2 ? 0 : 1,
                    factor: reset || cram ? 0 : 2500,
                    ivl: i % 7 === 0 ? -600 : i + 1,
                    lastIvl: i,
                    time: i % 3 ? 1000 : 0,
                })
            }
        }
        reviews.sort((a, b) => a.id - b.id)
        if (order === "shuffled") reviews.reverse()
        const expected = referenceReplay(reviews, source).map(snapshot)
        const columns = ["id", "cid", "ease", "ivl", "lastIvl", "time", "factor", "type"]
        const native = await loadRevlogPages(async () => ({
            columns,
            data: reviews.map((review) => columns.map((field) => review[field])),
        }))
        for (const history of [new RevlogHistory(packRevlogs(reviews)), native]) {
            expect(Array.from(prepareFsrsReplay(history, source), snapshot)).toEqual(expected)
            const selected = Array.from(prepareFsrsReplay(history, source, false), snapshot)
            expect(selected).toEqual(
                expected.map((step) => ({ ...step, startingState: undefined }))
            )
        }
    }
)
