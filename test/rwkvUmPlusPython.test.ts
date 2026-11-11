import { execFileSync } from "child_process"
import path from "path"

const result = JSON.parse(
    execFileSync("python3", [path.join(__dirname, "rwkvUmPlusFixture.py")], { encoding: "utf8" })
)

test("model-specific replays use their own curve and instant probabilities", () => {
    expect(result.curve).toEqual([
        [100, 0.5],
        [200, 0.51],
        [300, 0.52],
    ])
    expect(result.instant).toEqual([
        [100, 0.1],
        [200, 0.11],
        [300, 0.12000000000000001],
        [400, 0.13],
    ])
    expect(result.model_paths_distinct).toBe(true)
})

test("an unchanged cache is reused and an appended history only predicts new reviews", () => {
    expect(result.cache_hit).toBe(true)
    expect(result.append_queries).toBe(1)
    expect(result.append).toEqual([
        [100, 0.5],
        [200, 0.51],
        [300, 0.52],
        [400, 0.53],
    ])
})

test("editing history or corrupting the cache rebuilds all predictions", () => {
    expect(result.edit_queries).toBe(4)
    expect(result.corrupt_queries).toBe(4)
    expect(result.repaired).toEqual(result.edited)
})

test("changed model weights trigger a full replay and a failed replay preserves the last complete cache", () => {
    expect(result.weights_queries).toBe(4)
    expect(result.changed_weights).toEqual(result.edited)
    expect(result.failed_phase).toBe("failed")
    expect(result.failed_error).toContain("replay settings changed")
    expect(result.failed_preserves_cache).toBe(true)
})

test("a completed job can still serve its pending response after a new request starts", () => {
    expect(result.next_job_id).not.toBe(result.first_job_id)
    expect(result.old_job_response).toEqual([[100, 0.7]])
})

test("an incomplete native replay cannot be published as a complete model cache", () => {
    expect(result.incomplete_error).toContain("incomplete or invalid predictions")
})
