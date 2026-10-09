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
    expect(results.failure_records).toBe(1)
    expect(results.failure_pending).toBe(true)
    expect(results.retry_calls).toBe(1)
    expect(results.retry_pending).toBe(false)
    expect(results.retry.generated).toBe(true)
    expect(results.unsupported.warnings.join(" ")).toContain("cannot generate historical FSRS")
})

test("background service shares pending work, completes, reuses cache and reports cancellation", () => {
    expect(results.service.phase).toBe("ready")
    expect(results.service_calls_after_reopen).toBe(1)
    expect(results.service_failure.phase).toBe("failed")
    expect(results.service_failure.warnings.join(" ")).toContain("cancelled by user")
})

test("completion does no SQL and progress remains readable during a blocked cache check", () => {
    expect(results.completion_without_sql).toBe("ready")
    expect(results.snapshot_during_sql).toBe(true)
})

test("unchanged cache checks stay non-modal and only actual generation opens training progress", () => {
    expect(results.sparse_check).toMatchObject({ generated: false, needsGeneration: true })
    expect(results.calls_after_sparse_check).toBe(0)
    expect(results.reopen_check).toEqual({ generated: false, warnings: [] })
    expect(results.service_check_modal).toBe(false)
    expect(results.service_generation_modal).toBe(true)
    expect(results.service_reopen_modal).toBe(false)
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

test("10,000 overlay-routed cards use one batch call and resolve once per preset and deck", () => {
    expect(results.overlay).toEqual({ cards: 10000, batch_calls: 1, resolver_calls: 2 })
})

test("an existing partial RWKV cache triggers the real recompute API and reports remaining gaps", () => {
    expect(results.alignment_force_calls).toEqual([true, false])
    expect(results.alignment_api_calls).toEqual(["ensure", "recompute"])
    expect(results.incomplete_alignment.join(" ")).toContain("missing 1 FSRS validation review")
    expect(results.available_cache_changed).toBe(false)
    expect(results.api_calls_after_available_cache).toEqual(["ensure", "recompute"])
})

test("forced alignment lets Anki relabel stale data and replays only complete data", () => {
    expect(results.forced_stale_calls).toEqual(["ensure"])
    expect(results.forced_complete_calls).toEqual(["recompute"])
})


test("successful generation and checks skip unchanged requests without queuing work", () => {
    expect(results.service_fast_reopen).toEqual({
        phase: "ready", generated: false, warnings: [], coversRequest: true,
    })
    expect(results.service_fast_reopen_queued).toBe(0)
    expect(results.checked_reuse).toEqual({
        state: { phase: "ready", generated: false, warnings: [], coversRequest: true },
        queued: 0,
        same_token: true,
    })
})

test.each(["mod", "cache", "records", "cids", "collection", "fingerprint_error"])(
    "%s changes require a fresh background check",
    (change) => {
        expect(results[`invalidated_${change}`].state.phase).toBe("queued")
        expect(results[`invalidated_${change}`].queued).toBe(1)
    }
)

test("failed or cancelled work launches again and obsolete runs cannot replace completion", () => {
    expect(results.service_retry.phase).toBe("queued")
    expect(results.service_retry_queued).toBe(1)
    expect(results.obsolete_reuse.phase).toBe("ready")
    expect(results.obsolete_reuse_queued).toBe(0)
    expect(results.obsolete_generation_queries).toBe(0)
    expect(results.warning_reuse.warnings.join(" ")).toContain("cannot generate historical FSRS")
})
