/** @jest-environment jsdom */

import { get, writable } from "svelte/store"
import { createGraphFavorites, placeFavoriteGraph } from "../src/ts/graphFavorites"
import { createGraphPreference, graphIsVisible } from "../src/ts/graphPreferences"

afterEach(() => document.body.replaceChildren())

test("hiding overrides both category visibility and Favorites until hidden graphs are revealed", () => {
    const id = "fsrs:daily-logLoss"
    expect(graphIsVisible(id, true, [], [], false)).toBe(true)
    expect(graphIsVisible(id, false, [id], [], false)).toBe(true)
    expect(graphIsVisible(id, true, [], [id], false)).toBe(false)
    expect(graphIsVisible(id, true, [id], [id], false)).toBe(false)
    expect(graphIsVisible(id, false, [], [id], true)).toBe(true)
    expect(graphIsVisible(id, false, [id], [id], true)).toBe(true)
    expect(graphIsVisible(id, false, [], [], true)).toBe(false)
})

test("hidden choices save cumulatively, reload, and can be restored without altering other graphs", async () => {
    const saved: string[][] = []
    const selection = createGraphPreference(
        undefined,
        async (ids) => {
            saved.push([...ids])
        },
        "hidden graphs"
    )
    expect(saved).toEqual([])
    await Promise.all([selection.toggle("fsrs:daily-logLoss"), selection.toggle("rating:ratings")])
    expect(saved).toEqual([["fsrs:daily-logLoss"], ["fsrs:daily-logLoss", "rating:ratings"]])
    expect(get(createGraphPreference(saved[1], async () => {}, "hidden graphs").ids)).toEqual(
        saved[1]
    )
    await selection.toggle("fsrs:daily-logLoss")
    expect(get(selection.ids)).toEqual(["rating:ratings"])
})

test("failed hide and unhide writes preserve the previous list and allow retry", async () => {
    const save = jest
        .fn()
        .mockRejectedValueOnce(Error("hide failed"))
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(Error("unhide failed"))
        .mockResolvedValue(undefined)
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    try {
        const selection = createGraphPreference([], save, "hidden graphs")
        expect(await selection.toggle("fsrs:daily-logLoss")).toBe(false)
        expect(get(selection.ids)).toEqual([])
        expect(await selection.toggle("fsrs:daily-logLoss")).toBe(true)
        expect(await selection.toggle("fsrs:daily-logLoss")).toBe(false)
        expect(get(selection.ids)).toEqual(["fsrs:daily-logLoss"])
        expect(await selection.toggle("fsrs:daily-logLoss")).toBe(true)
        expect(get(selection.ids)).toEqual([])
    } finally {
        warn.mockRestore()
    }
})

test("revealed hidden Favorites use the hidden section and return to their saved pin position on Unhide", async () => {
    document.body.innerHTML =
        '<div id="home"><section data-graph-id="fsrs:daily-logLoss"></section></div><div id="favorites"></div><div id="hidden"></div>'
    const id = "fsrs:daily-logLoss"
    const favorites = createGraphFavorites([id], async () => {})
    const hidden = {
        ...createGraphPreference([], async () => {}, "hidden graphs"),
        target: writable<HTMLElement | null>(document.querySelector("#hidden")),
    }
    favorites.target.set(document.querySelector("#favorites"))
    const graph = document.querySelector<HTMLElement>("section")!
    const action = placeFavoriteGraph(graph, { id, favorites, hidden })!
    expect(graph.parentElement!.id).toBe("favorites")
    await hidden.toggle(id)
    expect(graph.parentElement!.id).toBe("hidden")
    expect(get(favorites.pinned)).toEqual([id])
    await hidden.toggle(id)
    expect(graph.parentElement!.id).toBe("favorites")
    expect(get(favorites.pinned)).toEqual([id])
    action.destroy()
    expect(document.querySelector("#hidden")!.childElementCount).toBe(0)
})
