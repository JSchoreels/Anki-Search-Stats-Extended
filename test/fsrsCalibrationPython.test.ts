import { execFileSync } from "child_process"
import path from "path"

const results = JSON.parse(
    execFileSync("python3", [path.join(__dirname, "fsrsCalibrationFixture.py")], {
        encoding: "utf8",
    })
)

test("a sparse recent cache triggers native validation generation with resolved preset settings", () => {
    expect(results.sparse.generated).toBe(true)
    expect(results.request).toMatchObject({
        search: "cid:10,13 (-is:suspended)",
        fsrs_version: "FSRS_VERSION_SEVEN",
        include_validation_folds: true,
        include_same_day_reviews: false,
        enable_scheduling_penalties: true,
        num_of_relearning_steps: 2,
        ignore_revlogs_before_ms: Date.UTC(2025, 0, 1),
    })
    expect(results.override_request.search).toBe("cid:11 (-is:suspended)")
    expect(results.override_request.params).toEqual(Array(34).fill(2))
})

test("completed history is reused after reopening and appending recent answers", () => {
    expect(results.calls_after_reopen).toBe(1)
    expect(results.calls_after_recent_answer).toBe(1)
    expect(results.existing_calls).toBe(0)
    expect(results.existing.generated).toBe(false)
    expect(results.no_fold_calls_after_reopen).toBe(1)
    expect(results.no_folds.warnings.join(" ")).toContain("no historical validation predictions")
})

test("history edits, cache loss and parameter changes require regeneration", () => {
    expect(results.calls_after_history_edit).toBe(2)
    expect(results.calls_after_cache_loss).toBe(3)
    expect(results.calls_after_parameter_change).toBe(4)
})

test("failure never records completion, retry succeeds, and unavailable APIs produce a warning", () => {
    expect(results.failure_records).toBe(0)
    expect(results.retry.generated).toBe(true)
    expect(results.unsupported.warnings.join(" ")).toContain("cannot generate historical FSRS")
})

test("background service shares pending work, completes, reuses cache and reports cancellation", () => {
    expect(results.service.phase).toBe("ready")
    expect(results.service_calls_after_reopen).toBe(1)
    expect(results.service_failure.phase).toBe("failed")
    expect(results.service_failure.warnings.join(" ")).toContain("cancelled by user")
})

test("10,000 ordinary cards resolve once per deck and use a short preset search", () => {
    expect(results.ordinary).toEqual({
        cards: 10000,
        resolver_calls: 1,
        config_calls: 1,
        search: 'preset:"Mining"',
    })
    expect(results.ordinary_api_search).toBe('preset:"Mining" (-is:suspended)')
})

test("an existing partial RWKV cache triggers the real recompute API and reports remaining gaps", () => {
    expect(results.alignment_force_calls).toEqual([true, false])
    expect(results.alignment_api_calls).toEqual(["ensure", "recompute"])
    expect(results.incomplete_alignment.join(" ")).toContain("missing 1 FSRS validation review")
})
