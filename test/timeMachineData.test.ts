import { buildTimeMachineCardData } from "../src/ts/timeMachineData"

test("Time Machine counts learning cards once and includes suspended cards in the total", () => {
    const counts: number[] = []
    counts[0] = 5
    counts[-2] = 3
    counts[-1] = 2
    counts[10] = 4
    counts[30] = 6

    const [day] = buildTimeMachineCardData([counts], { 0: 20 }, 0)
    expect(day.values).toEqual([6, 4, 3, 2, 2, 3])
    expect(day.values.reduce((sum, count) => sum + count, 0)).toBe(20)
})

test("Time Machine carries added totals across gaps and produces finite empty days", () => {
    expect(buildTimeMachineCardData([[], [], [], []], { [-2]: 2, 0: 1 }, 3)).toEqual([
        { label: "-3", values: [0, 0, 0, 0, 0, 0] },
        { label: "-2", values: [0, 0, 0, 0, 0, 2] },
        { label: "-1", values: [0, 0, 0, 0, 0, 2] },
        { label: "0", values: [0, 0, 0, 0, 0, 3] },
    ])
    expect(buildTimeMachineCardData(new Array(2), {}, 1).map((day) => day.values)).toEqual([
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
    ])
    expect(buildTimeMachineCardData([], {}, 0)).toEqual([])
})
