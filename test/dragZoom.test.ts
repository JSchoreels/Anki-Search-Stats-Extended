/** @jest-environment jsdom */

import { zoomBarWindow } from "../src/ts/barScrollable"
import { candlestickWindowStart, DeltaIfy } from "../src/ts/Candlestick"
import { boundedZoom, dragZoom, selectedZoomRange } from "../src/ts/dragZoom"

test("zoom ranges include selected dates/buckets, clamp to history, and accept either direction", () => {
    expect(selectedZoomRange({ start: 100, end: 200 }, 0.25, 0.75)).toEqual({
        start: 125,
        end: 175,
    })
    expect(selectedZoomRange({ start: 0, end: 29 }, 0.8, 0.2, true)).toEqual({ start: 6, end: 23 })
    expect(selectedZoomRange({ start: 0, end: 29 }, -1, 2, true)).toEqual({ start: 0, end: 29 })
    expect(selectedZoomRange({ start: 0, end: 29 }, 0.995, 1, true)).toEqual({ start: 29, end: 29 })
    expect(boundedZoom({ start: 50, end: 150 }, { start: 100, end: 200 })).toEqual({
        start: 100,
        end: 150,
    })
    expect(boundedZoom({ start: 50, end: 90 }, { start: 100, end: 200 })).toEqual({
        start: 100,
        end: 200,
    })
})

test("bar zoom retains grouping, pans in both directions, and does not mutate shared navigation", () => {
    const original = { bins: 30, offset: -14 }
    expect(zoomBarWindow(original, 7, 30, 5, 14, false)).toEqual({ bins: 10, offset: 119 })
    expect(zoomBarWindow(original, 7, 30, 5, 14, true)).toEqual({ bins: 10, offset: 49 })
    expect(original).toEqual({ bins: 30, offset: -14 })
})

test("candlestick zoom and panning keep the cumulative baseline, including negative deltas", () => {
    const values = [2, 5, 3, 8, 12, 10]
    const graph = {
        start: 2,
        data: DeltaIfy(values).map((delta, i) => ({ delta, label: String(i) })),
    }
    expect(candlestickWindowStart(graph, 1, 3)).toBe(3)
    expect(candlestickWindowStart(graph, 1, 5)).toBe(12)
    expect(candlestickWindowStart(graph, 1, 0)).toBe(0)
    expect(candlestickWindowStart({ ...graph, start: 0 }, -10, 3)).toBe(3)
})

function setup() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    document.body.append(svg)
    const rect = document.createElementNS(svg.namespaceURI, "rect")
    svg.append(rect)
    const onSelect = jest.fn()
    const click = jest.fn()
    rect.addEventListener("click", click)
    const action = dragZoom(svg, { width: 600, height: 250, onSelect })
    function pointer(target: EventTarget, type: string, x: number, y = 100, button = 0) {
        // jsdom has no PointerEvent; MouseEvent provides the coordinates used by the action.
        target.dispatchEvent(
            new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                button,
            })
        )
    }
    return { svg, rect, onSelect, click, action, pointer }
}

afterEach(async () => {
    document.body.replaceChildren()
    await new Promise((resolve) => setTimeout(resolve, 0))
})

test.each([
    [120, 480],
    [480, 120],
])("drag %s → %s shows a selection, zooms and suppresses the release click", (start, end) => {
    const e = setup()
    e.pointer(e.rect, "pointerdown", start)
    e.pointer(window, "pointermove", end)
    expect(e.svg.querySelector(".sse-zoom-selection")?.getAttribute("width")).toBe("360")
    e.pointer(window, "pointerup", end)
    e.pointer(e.rect, "click", end)
    expect(e.onSelect).toHaveBeenCalledWith(0.2, 0.8)
    expect(e.click).not.toHaveBeenCalled()
    expect(e.svg.querySelector(".sse-zoom-selection")).toBeNull()
    e.action.destroy()
})

test("ordinary clicks, tiny movements and trend handles retain their original click/drag behavior", () => {
    const e = setup()
    for (const delta of [0, 3]) {
        e.pointer(e.rect, "pointerdown", 120)
        e.pointer(window, "pointermove", 120 + delta)
        e.pointer(window, "pointerup", 120 + delta)
        e.pointer(e.rect, "click", 120 + delta)
    }
    expect(e.click).toHaveBeenCalledTimes(2)
    const handle = document.createElementNS(e.svg.namespaceURI, "circle")
    handle.setAttribute("class", "sse-trend-handle")
    e.svg.append(handle)
    e.pointer(handle, "pointerdown", 120)
    e.pointer(window, "pointermove", 480)
    e.pointer(window, "pointerup", 480)
    expect(e.onSelect).not.toHaveBeenCalled()
    e.action.destroy()
})

test("Escape cancels, outside/right-button gestures do not start, and endpoints clamp to the plot", () => {
    const e = setup()
    e.pointer(e.rect, "pointerdown", 120)
    e.pointer(window, "pointermove", 400)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    e.pointer(window, "pointerup", 400)
    expect(e.onSelect).not.toHaveBeenCalled()
    expect(e.svg.querySelector(".sse-zoom-selection")).toBeNull()
    e.pointer(e.rect, "pointerdown", -1)
    e.pointer(e.rect, "pointerdown", 100, 260)
    e.pointer(e.rect, "pointerdown", 100, 100, 2)
    e.pointer(window, "pointermove", 400)
    e.pointer(window, "pointerup", 400)
    expect(e.onSelect).not.toHaveBeenCalled()
    e.pointer(e.rect, "pointerdown", 120)
    e.pointer(window, "pointermove", 900)
    e.pointer(window, "pointerup", 900)
    expect(e.onSelect).toHaveBeenCalledWith(0.2, 1)
    e.action.destroy()
})

test("redraw/update, pointer cancellation, window blur and teardown remove gesture listeners", () => {
    const e = setup()
    for (const cancel of [
        () => e.action.update(undefined),
        () => e.pointer(window, "pointercancel", 300),
        () => window.dispatchEvent(new Event("blur")),
        () => e.action.destroy(),
    ]) {
        e.action.update({ width: 600, height: 250, onSelect: e.onSelect })
        e.pointer(e.rect, "pointerdown", 120)
        e.pointer(window, "pointermove", 300)
        cancel()
        e.pointer(window, "pointerup", 300)
        expect(e.onSelect).not.toHaveBeenCalled()
        expect(e.svg.querySelector(".sse-zoom-selection")).toBeNull()
    }
})
