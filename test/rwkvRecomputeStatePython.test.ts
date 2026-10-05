import { execFileSync } from "child_process"
import path from "path"

const results = JSON.parse(execFileSync("python3", [path.join(__dirname, "rwkvRecomputeStateFixture.py")], {
    encoding: "utf8",
}))

test("completed replay attempts reuse unchanged caches and record their own writes", () => {
    expect(results.first).toBe(true)
    expect(results.first_request_queries).toBe(0)
    expect(results.after_own_generation).toBe(false)
    expect(results.another_missing_review).toBe(true)
    expect(results.unrelated_search_and_cache_writes).toBe(false)
    expect(results.completed_attempt_reused).toBe(false)
    expect(results.empty_request).toBe(false)
    expect(results.empty_request_queries).toBe(0)
})

test("same-connection writes, external commits and replaced cache tables allow a new repair", () => {
    expect(results.rwkv_cache_cleared).toBe(true)
    expect(results.fsrs_cache_changed).toBe(true)
    expect(results.external_cache_commit).toBe(true)
    expect(results.cache_table_replaced).toBe(true)
})

test("profile changes reset attempts and failures retry without completion records", () => {
    expect(results.profile_changed).toBe(true)
    expect(results.failed_attempt_retries).toBe(true)
})
