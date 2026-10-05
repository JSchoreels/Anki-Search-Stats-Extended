import { execFileSync } from "child_process"
import path from "path"

const results = JSON.parse(
    execFileSync("python3", [path.join(__dirname, "rwkvRecentReviewsFixture.py")], {
        encoding: "utf8",
    })
)

test("recent FSRS cohort recovers captured RWKV answers and marks replay separately", () => {
    expect(results.selected).toEqual([
        [1, 0.7, "test_fold"],
        [2, 0.42, "post_optimization"],
        [3, 0.73, "post_optimization_replay"],
        [8, 0.78, "test_fold"],
        [10, 0.71, "post_optimization_replay"],
    ])
})

test("training rows, stale FSRS markers and state-cache rows stay excluded", () => {
    for (const id of [4, 5, 6, 7, 9, 11])
        expect(results.selected.map((row: unknown[]) => row[0])).not.toContain(id)
})

test("requested IDs, dates and old cache formats retain their scope", () => {
    expect(results.requested_only).toEqual([[3, 0.73, "post_optimization_replay"]])
    expect(results.date_scope).toEqual([
        [8, 0.78, "test_fold"],
        [10, 0.71, "post_optimization_replay"],
    ])
    expect(results.legacy).toBeNull()
    expect(results.no_fsrs_roles).toEqual([])
})

test("endpoint reports provenance and only explicit alignment forces missing recent replay", () => {
    expect(results.endpoint.role_counts).toEqual({
        test_fold: 2,
        post_optimization: 1,
        post_optimization_replay: 2,
    })
    expect(results.endpoint.data).toContainEqual([2, 0.42])
    expect(results.automatic_calls).toEqual([])
    expect(results.explicit_force).toBe(true)
    expect(results.explicit_missing_tail.warnings.join(" ")).toContain(
        "missing 1 post-optimization review"
    )
    expect(results.explicit_filled_tail.data).toEqual([[3, 0.73], [9, 0.79]])
    expect(results.explicit_filled_tail.role_counts).toEqual({ post_optimization_replay: 2 })
    expect(results.explicit_filled_tail.warnings).toEqual([])
})

test("an empty RWKV cache waits for active FSRS generation before launching its own replay", () => {
    expect(results.pending_fsrs_generated).toBe(false)
    expect(results.pending_fsrs_read.data).toEqual([])
    expect(results.pending_fsrs_read.refresh_after_fsrs).toBe(true)
    expect(results.explicit_filled_tail.refresh_after_fsrs).toBe(false)
    expect(results.explicit_filled_tail.data).toEqual([[3, 0.73], [9, 0.79]])
})

test("RWKV training reviews and unfillable gaps do not force a recompute on every load", () => {
    expect(results.training_force).toBe(false)
    expect(results.training_warnings.join(" ")).toContain(
        "2 FSRS calibration review(s) were RWKV training reviews"
    )
    expect(results.unfillable_forces).toEqual([true, false])
})

test("lazy generation preserves recent replay without an alignment flag and reads FSRS once", () => {
    expect(results.unflagged_generation.data).toEqual([[13, 0.76]])
    expect(results.unflagged_generation.role_counts).toEqual({ post_optimization_replay: 1 })
    expect(results.unflagged_generation.warnings).toEqual([])
    expect(results.unflagged_fsrs_reads).toBe(1)
})

test("completed endpoint replays don't loop, but a changed cache allows repair of the same reviews", () => {
    expect(results.cache_change_forces).toEqual([true, false, true])
})

test("failed endpoint replays are retried rather than recorded as completed", () => {
    expect(results.failure_forces).toEqual([true, true])
})
