import { execFileSync } from "child_process"
import path from "path"
const results = JSON.parse(
    execFileSync("python3", [path.join(__dirname, "predictionPagesFixture.py")], {
        encoding: "utf8",
    })
)
test("prediction transport serializes bounded pages lazily and retains the complete cohort metadata", () => {
    expect(results.metadata).toEqual({
        format: "prediction-pages-v1",
        row_count: 50001,
        column: "cache",
        roles: ["test_fold"],
        role_counts: { test_fold: 50001 },
        warnings: ["日本語 warning"],
        refresh_after_fsrs: true,
    })
    expect(results.lazy_sizes).toEqual([0])
    expect(results.page_sizes).toEqual([25000, 25000, 1])
    expect(results.done).toEqual({ done: true })
    expect(results.reassembled_equal).toBe(true)
    expect(results.legacy_equal).toBe(true)
    expect(results.empty).toEqual([
        { format: "prediction-pages-v1", row_count: 0, column: null },
        { done: true },
    ])
})
