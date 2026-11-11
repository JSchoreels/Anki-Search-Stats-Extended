import { execFileSync } from "child_process"
import path from "path"

const result = JSON.parse(
    execFileSync("python3", [path.join(__dirname, "currentModelComparisonFixture.py")], {
        encoding: "utf8",
    })
)

test("current model scores replay history and use the requested head and current elapsed time", () => {
    expect(result.instant).toEqual({
        phase: "complete",
        rows: [
            [1, 0.31],
            [2, 0.32],
        ],
    })
    expect(result.curve).toEqual({
        phase: "complete",
        rows: [
            [1, 0.61],
            [2, 0.62],
        ],
    })
    expect(result.calls).toContainEqual(["instant", "sm98"])
    expect(result.calls).toContainEqual(["curve", 1])
    expect(result.searches.slice(0, 2)).toEqual(["cid:1,2,3", "cid:1,2"])
})

test("stale, cancelled and wrong-profile replays do not publish scores", () => {
    expect(result.stale.phase).toBe("failed")
    expect(result.stale.rows).toEqual([])
    expect(result.stale.error).toMatch(/history or model changed/)
    expect(result.cancelled).toBe("cancelled")
    expect(result.wrong_profile.phase).toBe("failed")
    expect(result.wrong_profile.error).toMatch(/profile changed/)
})

test("jobs deduplicate card IDs and release resources after cancellation", () => {
    expect(result.selected).toEqual([1, 2])
    expect(result.released).toBe(true)
    expect(result.empty.phase).toBe("complete")
    expect(result.empty_rows).toEqual({ data: [] })
})
