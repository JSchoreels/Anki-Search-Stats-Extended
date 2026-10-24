import {
    barScrollExtent,
    barScrollOffset,
    barScrollPosition,
    effectiveBarDataLength,
    leftAlignedBarWindowEnd,
} from "../src/ts/barScrollable"

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

test("scroll extent preserves numeric origins and trims only a distribution's trailing empty bins", () => {
    const data = [0, 0, 4, 0, 8, 0, 0].map((value) => ({ values: [value] }))
    expect(barScrollExtent(data, true, false)).toBe(5)
    expect(barScrollExtent(data, false, false)).toBe(7)
    expect(barScrollExtent([], true, false)).toBe(0)
    expect(barScrollExtent([{ values: [0] }], true, false)).toBe(0)
})

test("date charts omit epoch padding but retain gaps and recent quiet days", () => {
    const data = new Array(20000).concat([3, 0, 0, 8, 0, 0].map((value) => ({ values: [value] })))
    expect(barScrollExtent(data, false, true)).toBe(6)
    expect(barScrollExtent(new Array(20000), false, true)).toBe(0)
})

test("scrolling distributions right moves to larger values and synchronizes numeric offsets", () => {
    expect(barScrollPosition(0, 70, true)).toBe(0)
    expect(barScrollPosition(25, 70, true)).toBe(25)
    expect(barScrollOffset(70, 70, true)).toBe(70)
    expect(barScrollOffset(0, 70, true)).toBe(0)
    // Manual negative and past-end offsets keep their existing semantics in the chart.
    expect(barScrollPosition(-25, 70, true)).toBe(25)
    expect(barScrollPosition(1000, 70, true)).toBe(70)
})

test("right-aligned charts start at the right edge, scroll left to older buckets, and return to today", () => {
    expect(barScrollPosition(0, 70, false)).toBe(70)
    expect(barScrollPosition(25, 70, false)).toBe(45)
    expect(barScrollOffset(0, 70, false)).toBe(70)
    expect(barScrollOffset(70, 70, false)).toBe(0)
    expect(barScrollPosition(-25, 70, false)).toBe(45)
    expect(barScrollPosition(1000, 70, false)).toBe(0)
})
