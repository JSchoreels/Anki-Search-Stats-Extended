import { execFileSync } from "child_process"
import path from "path"

const result = JSON.parse(
    execFileSync("python3", [path.join(__dirname, "revlogPagesFixture.py")], { encoding: "utf8" })
)

test("paged history includes every row exactly once, including an exact full-page boundary", () => {
    expect(result.all).toEqual({
        ids: Array.from({ length: 8 }, (_, i) => 1700000000001 + i),
        sizes: [2, 2, 2, 2, 0],
    })
})

test("every history page preserves both the card selection and day cutoff", () => {
    expect(result.filtered).toEqual({ ids: [1700000000005, 1700000000007], sizes: [2, 0] })
    expect(result.empty).toEqual({ ids: [], sizes: [0] })
})
