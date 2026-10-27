import { execFileSync } from "child_process"
import path from "path"

const result = JSON.parse(
    execFileSync("python3", [path.join(__dirname, "rwkvReviewGainFixture.py")], {
        encoding: "utf8",
    })
)

test("RWKV replay compares each scored answer before and after in chronological state", () => {
    expect(result.progress.firstDay).toBe(2)
    expect(result.progress.countByDay).toEqual([1, 0, 2, 0, 1, 0])
    expect(result.progress.gainByDay[0]).toBeCloseTo(0.8)
    expect(result.progress.gainByDay[2]).toBeCloseTo(0.2)
    expect(result.progress.gainByDay[4]).toBeCloseTo(0.4)
    expect(result.updates).toEqual([1, 2, 1, 1, 3, 3, 2])
    expect(result.queries).toEqual([1, 1, 1, 3])
})

test("earlier answers still reconstruct state when outside the selected history", () => {
    expect(result.cutoff.countByDay).toEqual([0, 0, 2, 0, 0, 0])
    expect(result.cutoff.gainByDay[2]).toBeCloseTo(0.2)
})

test("cancelled or invalid predictions do not enter the reported gain", () => {
    expect(result.cancelled_updates).toEqual([])
    expect(result.invalid.countByDay).toEqual([0, 0, 0, 0, 0, 0])
})

test("batched replay matches per-answer replay, including a batch boundary", () => {
    expect(result.batch.countByDay).toEqual(result.progress.countByDay)
    result.batch.gainByDay.forEach((gain: number, day: number) =>
        expect(gain).toBeCloseTo(result.progress.gainByDay[day], 6)
    )
    expect(result.large_batch.countByDay).toEqual(result.large_reference.countByDay)
    result.large_batch.gainByDay.forEach((gain: number, day: number) =>
        expect(gain).toBeCloseTo(result.large_reference.gainByDay[day], 6)
    )
})

test("non-answer entries do not count as prior answers, while undated answers advance state", () => {
    expect(result.edge_updates).toEqual([4, 5, 5])
    expect(result.edge.countByDay).toEqual([1, 1])
    expect(result.edge.gainByDay[0]).toBeCloseTo(0.8)
    expect(result.edge.gainByDay[1]).toBeCloseTo(0.3)
    expect(result.edge_batch.countByDay).toEqual(result.edge.countByDay)
    result.edge_batch.gainByDay.forEach((gain: number, day: number) =>
        expect(gain).toBeCloseTo(result.edge.gainByDay[day], 6)
    )
})

test.each(["600", "3600", "86400"])(
    "future RWKV queries agree between per-answer and batched replay at %s seconds",
    (horizon) => {
        const { slow, fast } = result.future_runs[horizon]
        expect(fast.countByDay).toEqual(slow.countByDay)
        for (const key of ["withByDay", "withoutByDay", "gainByDay"]) {
            fast[key].forEach((value: number, day: number) =>
                expect(value).toBeCloseTo(slow[key][day], 6)
            )
        }
        expect(slow.withByDay[0]).toBeCloseTo(0.85)
        expect(slow.withoutByDay[0]).toBe(0)
        expect(slow.gainByDay[2]).toBeCloseTo(0.5)
    }
)

test("future queries advance scheduler days only when the horizon crosses rollover", () => {
    expect(result.crossing.before).toEqual([5, 2, 87000])
    expect(result.crossing.after).toEqual([5, 1, 600])
    expect(result.crossing.no_crossing).toEqual([4, 0, 600])
})

test("future comparison excludes an answer with an unknown previous elapsed time", () => {
    expect(result.missing_slow.countByDay).toEqual([1, 0, 0])
    expect(result.missing_fast.countByDay).toEqual(result.missing_slow.countByDay)
})

test.each([
    ["slow_bridge", true],
    ["fast_bridge", false],
])("reports replay capability before loading history for %s", (key, slowReplay) => {
    const run = result[key]
    expect(run.slow_during_load).toEqual([slowReplay])
    expect(run.progress.slowReplay).toBe(slowReplay)
    expect(run.progress.phase).toBe("complete")
    expect(run.progress.countByDay).toEqual(result.progress.countByDay)
})

test("a future horizon warns on an older bridge and uses the new batch API when available", () => {
    expect(result.old_future_bridge.progress.slowReplay).toBe(true)
    expect(result.new_future_bridge.progress.slowReplay).toBe(false)
    expect(result.new_future_bridge.steps).toEqual(["history", "timing"])
    expect(result.old_future_bridge.progress.countByDay).toEqual(
        result.new_future_bridge.progress.countByDay
    )
    expect(result.invalid_horizon).toMatch(/Unsupported review recall horizon/)
})

test("a cancelled replay waits for its predecessor before releasing its successor", () => {
    expect(result.cancellation_chain).toEqual({
        predecessor_wait_calls: 2,
        middle_finished: true,
        phase: "cancelled",
    })
})
