import { effectiveBarDataLength, leftAlignedBarWindowEnd } from "../src/ts/barScrollable"

test("effective bar data length trims trailing empty values", () => {
    expect(
        effectiveBarDataLength([{ values: [0] }, { values: [2] }, { values: [0] }, { values: [0] }])
    ).toBe(2)
})

test("left aligned bar window stops at the last non-empty bar", () => {
    const data = Array.from({ length: 30 }, (_, index) => ({
        values: [index < 20 ? 1 : 0],
    }))

    expect(leftAlignedBarWindowEnd(0, 30, 1, data)).toBe(20)
})

test("left aligned bar window rounds partial final bins up to bar width", () => {
    const data = Array.from({ length: 30 }, (_, index) => ({
        values: [index < 20 ? 1 : 0],
    }))

    expect(leftAlignedBarWindowEnd(0, 30, 7, data)).toBe(21)
})

test("left aligned bar window returns an empty range when scrolled past data", () => {
    const data = [{ values: [1] }, { values: [1] }]

    expect(leftAlignedBarWindowEnd(10, 40, 1, data)).toBe(10)
})
