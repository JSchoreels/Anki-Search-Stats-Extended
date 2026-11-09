import { execFileSync } from "child_process"
import path from "path"

const result = JSON.parse(
    execFileSync("python3", [path.join(__dirname, "rwkvStabilityFixture.py")], {
        encoding: "utf8",
    })
)

const { target, decay, min, max } = result.constants
const through = (e: number, r: number) =>
    ((target ** (-1 / decay) - 1) * e) / (r ** (-1 / decay) - 1)
const driftAt = (drift: number[], k: number) => drift[result.drift.k_frozen.indexOf(k)]

test("S90 interpolates the first crossing in log time", () => {
    expect(result.s90.crossing).toBeCloseTo(2 * 2 ** (1 / 3), 10)
    expect(result.s90.at_target).toBeCloseTo(1, 10)
})

test("S90 extrapolates on the forgetting curve when the grid misses the crossing", () => {
    expect(result.s90.below_first).toBeCloseTo(through(0.5, 0.8), 10)
    expect(result.s90.never_crossing).toBeCloseTo(through(10, 0.95), 10)
    expect(result.s90.max_clamp).toBe(max)
    expect(result.s90.min_clamp).toBeCloseTo(min, 12)
})

test("drift is a capped per-horizon median that only changes at refit boundaries", () => {
    const { before, at, after_late, next } = result.drift
    expect(before.every((value: number) => value === 0)).toBe(true)
    expect(driftAt(at, 0)).toBe(0)
    expect(driftAt(at, 1)).toBe(0) // upward drift is capped
    expect(Math.abs(driftAt(at, 2) + 0.3)).toBeLessThanOrEqual(0.02)
    expect(driftAt(at, 3)).toBe(driftAt(at, 2)) // 199 pairs: carries k = 2
    expect(driftAt(at, 300)).toBe(driftAt(at, 2))
    expect(Math.abs(driftAt(at, 365) + 1)).toBeLessThanOrEqual(0.02)
    expect(driftAt(at, 3650)).toBe(driftAt(at, 365))
    expect(after_late).toEqual(at) // pairs known after a boundary wait for the next one
    expect(Math.abs(driftAt(next, 2) + 3)).toBeLessThanOrEqual(0.02)
    expect(driftAt(next, 1)).toBe(0)
})

test("drift interpolates linearly in ln k between horizons", () => {
    expect(result.drift_at.k0).toBe(0)
    expect(result.drift_at.k_half).toBeCloseTo(-0.1, 10)
    expect(result.drift_at.k8).toBeCloseTo(-0.8, 10)
    expect(result.drift_at.k9).toBeCloseTo(-0.8 - (0.1 * Math.log(9 / 8)) / Math.log(10 / 8), 10)
    expect(result.drift_at.k500).toBeCloseTo(-2.8, 10)
})

test("day stats give the exact median, mean and young share of current S90s", () => {
    const { empty, even, updated, odd } = result.card_stats
    expect(empty).toEqual([null, null, null, 0])
    expect(even).toEqual([17.5, 19, 0.5, 4])
    expect(updated).toEqual([27.5, 24, 0.25, 4])
    expect(odd[0]).toBe(25)
    expect(odd[1]).toBeCloseTo(23.4, 10)
    expect(odd[2]).toBeCloseTo(0.2, 10) // S90 = 21 is not young
    expect(odd[3]).toBe(5)
})

test("live pairs stop when the card has its own entry, and unselected cards still pair", () => {
    const { pairs, queries, warm_calls } = result.falling
    expect(pairs).toEqual({
        "1:1": 6,
        "2:2": 5, // card 1 answered on day 2
        "3:3": 4, // card 10 had an ungraded entry on day 3
        "3:1": 1,
        "4:4": 4,
        "4:2": 1,
        "5:5": 3, // card 2 answered on day 5
        "5:3": 1,
        "6:6": 3,
        "6:4": 1,
        "6:1": 1,
        "7:7": 3,
        "7:5": 1,
        "7:2": 1,
        "8:8": 2, // only the unselected cards 11 and 12 remain
        "8:6": 1,
        "8:3": 1,
    })
    // Frozen grids: 37 points for each of the 6 selected anchors, the reachable
    // K_LIVE points for unselected ones (3 x 8 on day 0, 7 + 6 + ... + 1 for
    // card 13), plus one query per live pair.
    expect(queries).toBe(6 * 37 + 3 * 8 + 28 + 39)
    expect(warm_calls).toEqual([
        [1, 2, 3, 10, 11, 12, 1],
        [13],
        [1, 13],
        [10, 13],
        [13],
        [2, 13],
        [13],
        [13],
        [3, 13],
    ])
})

test("each refit only uses pairs known before its boundary", () => {
    const refits = result.falling.refits.map((refit: any) => [refit.boundary, refit.counts])
    expect(refits).toEqual([
        [2, { 1: 6 }],
        [4, { 1: 7, 2: 5, 3: 4 }],
        [6, { 1: 7, 2: 6, 3: 5, 4: 4, 5: 3 }],
        [8, { 1: 8, 2: 7, 3: 5, 4: 5, 5: 4, 6: 3, 7: 3 }],
    ])
})

test("a falling live recall corrects S90 downward from the refit in force", () => {
    const { progress, day0, day2, card1_day2, card1_day2_frozen, max_gap, refits } = result.falling
    expect(max_gap).toBeLessThan(0)
    for (const refit of refits) {
        expect(refit.drift.every((value: number) => value <= 0)).toBe(true)
    }
    expect(driftAt(refits[0].drift, 1)).toBeLessThan(0)
    expect(card1_day2).toBeLessThan(card1_day2_frozen)
    expect(progress.firstDay).toBe(0)
    for (const [day, expected] of [
        [0, day0],
        [2, day2],
    ]) {
        expect(progress.medianByDay[day]).toBeCloseTo(expected[0], 9)
        expect(progress.meanByDay[day]).toBeCloseTo(expected[1], 9)
        expect(progress.youngRatioByDay[day]).toBeCloseTo(expected[2], 12)
        expect(progress.cardCountByDay[day]).toBe(expected[3])
    }
})

test("an upward drift is capped to zero, leaving the frozen S90", () => {
    const { progress, refits, min_gap, day0, pairs } = result.rising
    expect(min_gap).toBeGreaterThan(0)
    expect(pairs).toEqual(result.falling.pairs)
    for (const refit of refits) {
        expect(refit.drift.every((value: number) => value === 0)).toBe(true)
    }
    expect(progress.medianByDay[0]).toBeCloseTo(day0[0], 9)
    expect(progress.meanByDay[0]).toBeCloseTo(day0[1], 9)
})

test("stats count only selected cards and carry the last history day through today", () => {
    const { progress } = result.falling
    expect(progress.cardCountByDay).toEqual(Array(13).fill(3))
    for (const key of ["medianByDay", "meanByDay", "youngRatioByDay", "cardCountByDay"]) {
        expect(progress[key]).toHaveLength(13) // days 0..12, history ends on day 8
        for (let day = 9; day <= 12; day++) expect(progress[key][day]).toBe(progress[key][8])
    }
    expect(progress.medianByDay[5]).not.toBe(progress.medianByDay[4]) // card 2 re-anchored
    expect(progress.current).toBe(progress.total)
})

test("undated entries warm up with the current day but never anchor", () => {
    const { progress, warm_calls } = result.edge
    expect(warm_calls).toEqual([[4, 1, 2], [3]])
    expect(progress.firstDay).toBe(0)
    expect(progress.cardCountByDay).toEqual([1, 2])
    expect(result.undated.firstDay).toBeNull()
    expect(result.undated.medianByDay).toEqual([])
})

test("out-of-order history is rejected", () => {
    expect(result.errors.ids).toMatch(/not in chronological order/)
    expect(result.errors.days).toMatch(/review days are not in chronological order/)
    expect(result.errors.lengths).toMatch(/mismatched input and ID counts/)
})

test("cancellation discards the partial arrays", () => {
    const { seen, final } = result.cancel
    expect(seen.medianByDay.length).toBeGreaterThan(0)
    expect(final.phase).toBe("cancelled")
    expect(final.done).toBe(true)
    for (const key of ["medianByDay", "meanByDay", "youngRatioByDay", "cardCountByDay"]) {
        expect(final[key]).toEqual([])
    }
})

test("a completed run publishes the replay, and a changed history fails it", () => {
    expect(result.run.phase).toBe("complete")
    expect(result.run.done).toBe(true)
    expect(result.run.medianByDay).toEqual(result.falling.progress.medianByDay)
    expect(result.changed.phase).toBe("failed")
    expect(result.changed.error).toBe(
        "RWKV history changed during replay. Reopen Statistics to retry."
    )
    expect(result.changed.medianByDay).toEqual([])
    expect(result.changed_traceback).toBe(true)
})

test("a job is reused for the same history and cards, and replaced otherwise", () => {
    const { started, reused, reused_phase, replaced, replaced_done, stale } = result.jobs
    expect(reused).toBe(started)
    expect(reused_phase).toBe("complete")
    expect(replaced).not.toBe(started)
    expect(replaced_done).toBe("complete")
    expect(stale).toEqual({ phase: "cancelled", done: true, jobId: started })
})
