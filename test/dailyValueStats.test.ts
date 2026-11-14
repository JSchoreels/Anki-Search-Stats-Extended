import { DailyTransitions } from "../src/ts/dailyTransitions"
import { dailyValueStats } from "../src/ts/dailyValueStats"

test("tracks exact daily mean and median through updates and resets", () => {
    const events = new DailyTransitions()
    events.set(1, 1, 2)
    events.set(1, 2, 8)
    events.set(2, 1, 3)
    events.set(2, 1, 4)
    events.set(3, 2, null)
    events.set(5, 1, null)

    const stats = dailyValueStats(events, [1, 2, 3, 5], 5)
    expect(stats.means[1]).toBe(5)
    expect(stats.medians[1]).toBe(5)
    expect(stats.means[2]).toBe(6)
    expect(stats.medians[2]).toBe(6)
    expect(stats.means[3]).toBe(4)
    expect(stats.medians[3]).toBe(4)
    expect(stats.means[4]).toBe(4)
    expect(stats.means[5]).toBeUndefined()
})

test("weights repeated values when finding an odd median", () => {
    const events = new DailyTransitions()
    events.set(7, 1, 1)
    events.set(7, 2, 5)
    events.set(7, 3, 5)
    const stats = dailyValueStats(events, [7], 7)
    expect(stats.means[7]).toBeCloseTo(11 / 3)
    expect(stats.medians[7]).toBe(5)
})

test("matches direct daily sorting across repeated updates and resets", () => {
    const events = new DailyTransitions()
    const current = new Map<number, number>()
    const expected: { mean?: number; median?: number }[] = []
    let seed = 137
    const next = () => (seed = (seed * 48271) % 2147483647)
    for (let day = 0; day < 20; day++) {
        for (let change = 0; change < 6; change++) {
            const card = next() % 8
            const value = next() % 5 === 0 ? null : ((next() % 91) + 10) / 10
            events.set(day, card, value)
            if (value === null) current.delete(card)
            else current.set(card, value)
        }
        const values = Array.from(current.values()).sort((a, b) => a - b)
        expected.push(
            values.length
                ? {
                      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
                      median:
                          (values[Math.floor((values.length - 1) / 2)] +
                              values[Math.floor(values.length / 2)]) /
                          2,
                  }
                : {}
        )
    }
    const stats = dailyValueStats(
        events,
        Array.from({ length: 20 }, (_, day) => day),
        19
    )
    for (let day = 0; day < expected.length; day++) {
        if (expected[day].mean === undefined) {
            expect(stats.means[day]).toBeUndefined()
            expect(stats.medians[day]).toBeUndefined()
        } else {
            expect(stats.means[day]).toBeCloseTo(expected[day].mean!, 10)
            expect(stats.medians[day]).toBeCloseTo(expected[day].median!, 10)
        }
    }
})
