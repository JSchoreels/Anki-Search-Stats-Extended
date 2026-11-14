import { execFileSync } from "child_process"
import path from "path"

const results = JSON.parse(
    execFileSync("python3", [path.join(__dirname, "fsrs6ComparisonFixture.py")], {
        encoding: "utf8",
    })
)

test("FSRS-6 uses home-deck preset groups and reports missing saved parameters", () => {
    expect(results.first.rows[0][0]).toBe(200)
    expect(results.first.rows[0][1]).toBeCloseTo(0.3)
    expect(results.first.warnings.join(" ")).toContain("1 selected deck")
    expect(results.first.request).toMatchObject({
        search: "did:1,2 (tag:learn)",
        params: Array(21).fill(1),
        num_of_relearning_steps: 2,
        include_validation_folds: true,
    })
    expect(results.groups.map((group: { search: string }) => group.search)).toEqual([
        "did:1,2 (tag:learn)",
        "did:4 (-is:suspended)",
    ])
    expect(results.missing).toContain("no selected decks have saved FSRS-6 parameters")
})

test("saved predictions are reused only while history, parameters and content match", () => {
    expect(results.calls_after_cache_hit).toBe(1)
    expect(results.calls_after_history_change).toBe(2)
    expect(results.calls_after_params_change).toBe(3)
    expect(results.calls_after_corruption).toBe(4)
    expect(results.concurrent_change).toContain("Review history changed")
})

test("saved-parameter replay and held-out validation are isolated", () => {
    expect(results.final_fit.rows.map((row: number[]) => row[0])).toEqual([100, 200])
    expect(results.final_fit.request.include_validation_folds).toBe(false)
})

test("FSRS-6 preparation runs as a serialized collection query and releases its job", () => {
    expect(results.queued_phase).toBe("waiting")
    expect(results.finished_phase).toBe("complete")
    expect(results.served_rows.map((row: number[]) => row[0])).toEqual([100, 200])
    expect(results.cancelled_job).toBe("failed")
})
