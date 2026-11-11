import { execFileSync } from "child_process"
import path from "path"

const result = JSON.parse(
    execFileSync("python3", [path.join(__dirname, "currentDisagreementLoggingFixture.py")], {
        encoding: "utf8",
    })
)

test("large current-prediction searches keep summary diagnostics without dumping card IDs", () => {
    expect(result.searches_unchanged).toBe(true)
    expect(result.result).toMatchObject({ status: "ready", total: 200 })
    expect(result.result.rows).toEqual([
        { cid: 1, fsrs: 0.9, rwkv: 0.75 },
        { cid: 2, fsrs: 0.9, rwkv: 0.8 },
    ])
    const scoped = result.first_messages.filter((message: { text: string }) =>
        message.text.includes("<selected 200 card IDs>")
    )
    expect(scoped).toHaveLength(3)
    expect(scoped.some((message: { level: string }) => message.level === "WARNING")).toBe(true)
    expect(
        scoped.every((message: { text: string }) => !message.text.includes(result.full_search))
    ).toBe(true)
    expect(
        result.first_messages.filter((message: { text: string }) =>
            message.text.startsWith("RWKV review inputs")
        )
    ).toEqual([{ level: "DEBUG", text: "RWKV review inputs scored from resident state: inputs=3" }])
})

test("other threads and later requests retain normal logging, including after failures", () => {
    expect(result.first_messages).toContainEqual({
        level: "DEBUG",
        text: `outside operation: search='${result.full_search}'`,
    })
    expect(result.short_result.status).toBe("ready")
    expect(result.short_messages).toContainEqual({
        level: "DEBUG",
        text: "RWKV stats preparation started: search='cid:1,2'",
    })
    expect(result.failed_result.status).toBe("failed")
    expect(result.failure_messages).toContainEqual({
        level: "ERROR",
        text: "Current FSRS/RWKV disagreement snapshot failed",
    })
    expect(result.failure_messages).toContainEqual({
        level: "DEBUG",
        text: `after failure: search='${result.full_search}'`,
    })
})

test("current sources can be compared without requiring the other model", () => {
    expect(result.independent_fsrs).toEqual({
        status: "ready",
        data: [
            [1, 0.9],
            [2, 0.9],
            [3, 0.9],
        ],
    })
    expect(result.without_fsrs).toMatchObject({
        status: "unavailable",
        rwkvStatus: "ready",
        rwkvScores: [
            [1, 0.75],
            [2, 0.8],
        ],
        rows: [],
    })
})
