import { DailyTransitions } from "../src/ts/dailyTransitions"

test("compact daily changes match nested maps across chunks, resets and repeated same-day reviews", () => {
    const compact = new DailyTransitions()
    const reference = new Map<number, Map<number, number | null>>()
    for (const day of [-5, 0, 10]) {
        const changes = new Map<number, number | null>()
        reference.set(day, changes)
        for (let i = 0; i < 20000; i++) {
            const cid = 1730212469023 + i
            const key = i % 11 === 0 ? null : i / 7
            compact.set(day, cid, key)
            changes.set(cid, key)
        }
        // Updates must preserve first-seen card order, including reset then review.
        for (const [cid, key] of [
            [1730212469024, null],
            [1730212469023, 0],
            [1730212469024, 0.123456789],
        ] as const) {
            compact.set(day, cid, key)
            changes.set(cid, key)
        }
    }
    for (const [day, changes] of reference) expect([...compact.entries(day)]).toEqual([...changes])
    expect([...compact.entries(3)]).toEqual([])
    compact.release()
    for (const day of reference.keys()) expect([...compact.entries(day)]).toEqual([])
})

test("daily changes reject revisiting an earlier day instead of losing its changes", () => {
    const changes = new DailyTransitions()
    changes.set(1, 7, 10)
    changes.set(3, 7, null)
    expect(() => changes.set(1, 7, 20)).toThrow("chronological")
    expect([...changes.entries(1)]).toEqual([[7, 10]])
})

test("a reset is distinct from numeric keys, including NaN and infinity", () => {
    const changes = new DailyTransitions()
    changes.set(1, 1, null)
    changes.set(1, 2, NaN)
    changes.set(1, 3, Infinity)
    expect([...changes.entries(1)]).toEqual([
        [1, null],
        [2, NaN],
        [3, Infinity],
    ])
})
