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
