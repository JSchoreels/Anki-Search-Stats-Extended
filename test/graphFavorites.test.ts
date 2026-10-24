/** @jest-environment jsdom */

import { get, writable } from "svelte/store"
import {
    aboveNativeGraphs,
    createGraphFavorites,
    placeFavoriteGraph,
} from "../src/ts/graphFavorites"

import {
    categoryHasGraphs,
    createGraphPreference,
    normalizeGraphIds,
} from "../src/ts/graphPreferences"
const hiddenSelection = () => ({
    ...createGraphPreference([], async () => {}, "test hidden"),
    target: writable<HTMLElement | null>(null),
})

afterEach(() => document.body.replaceChildren())

test("saved graph IDs are unique, namespaced, and independent of localized titles", () => {
    expect(normalizeGraphIds(undefined)).toEqual([])
    expect(
        normalizeGraphIds([
            "fsrs:daily-logLoss",
            null,
            2,
            "",
            "Daily Surprise",
            "fsrs:daily-logLoss",
            "rating:ratings",
        ])
    ).toEqual(["fsrs:daily-logLoss", "rating:ratings"])
    expect(categoryHasGraphs(["fsrs:daily-logLoss"], "fsrs")).toBe(true)
    expect(categoryHasGraphs(["fsrs:daily-logLoss"], "f")).toBe(false)
})

test("pinning and unpinning serialize cumulative saves and retain their order on reload", async () => {
    const saved: string[][] = []
    const favorites = createGraphFavorites([], async (ids) => {
        saved.push([...ids])
    })
    expect(saved).toEqual([])
    await Promise.all([favorites.toggle("fsrs:daily-logLoss"), favorites.toggle("rating:ratings")])
    expect(saved).toEqual([["fsrs:daily-logLoss"], ["fsrs:daily-logLoss", "rating:ratings"]])
    expect(get(createGraphFavorites(saved[1], async () => {}).pinned)).toEqual(saved[1])
    await favorites.toggle("fsrs:daily-logLoss")
    expect(get(favorites.pinned)).toEqual(["rating:ratings"])
    await favorites.toggle("fsrs:daily-logLoss")
    expect(get(favorites.pinned)).toEqual(["rating:ratings", "fsrs:daily-logLoss"])
})

test("a failed save leaves the graph in place and a later pin retries", async () => {
    const save = jest.fn().mockRejectedValueOnce(new Error("failed")).mockResolvedValue(undefined)
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    try {
        const favorites = createGraphFavorites(["rating:ratings"], save)
        expect(await favorites.toggle("fsrs:daily-logLoss")).toBe(false)
        expect(get(favorites.pinned)).toEqual(["rating:ratings"])
        expect(await favorites.toggle("fsrs:daily-logLoss")).toBe(true)
        expect(get(favorites.pinned)).toEqual(["rating:ratings", "fsrs:daily-logLoss"])
    } finally {
        warn.mockRestore()
    }
})

test("moving a card preserves its node, controls, focus, and exact return position", async () => {
    document.body.innerHTML =
        '<div id="home"><i></i><section data-graph-id="fsrs:daily-logLoss"><input value="7"><button>Pin</button></section><b></b></div><div id="favorites"></div>'
    const home = document.querySelector<HTMLElement>("#home")!
    const destination = document.querySelector<HTMLElement>("#favorites")!
    const graph = home.querySelector<HTMLElement>("section")!
    const button = graph.querySelector("button")!
    graph.querySelector("input")!.value = "14"
    const favorites = createGraphFavorites([], async () => {})
    favorites.target.set(destination)
    const action = placeFavoriteGraph(graph, {
        id: "fsrs:daily-logLoss",
        favorites,
        hidden: hiddenSelection(),
    })!
    button.focus()
    await favorites.toggle("fsrs:daily-logLoss")
    expect(destination.firstElementChild).toBe(graph)
    expect(document.activeElement).toBe(button)
    expect(graph.querySelector("input")!.value).toBe("14")
    await favorites.toggle("fsrs:daily-logLoss")
    expect([...home.children].map((child) => child.tagName)).toEqual(["I", "SECTION", "B"])
    expect(destination.childElementCount).toBe(0)
    expect(document.activeElement).toBe(button)
    action.destroy()
    expect(home.querySelector("section")).toBeNull()
})

test("saved pin order wins over mount order and cards return home when the target closes", () => {
    const favorites = createGraphFavorites(["rating:ratings", "fsrs:daily-logLoss"], async () => {})
    const home = document.createElement("div")
    const destination = document.createElement("div")
    document.body.append(home, destination)
    favorites.target.set(destination)
    const nodes = ["fsrs:daily-logLoss", "rating:ratings"].map((id) => {
        const node = document.createElement("section")
        node.dataset.graphId = id
        home.append(node)
        return {
            node,
            action: placeFavoriteGraph(node, { id, favorites, hidden: hiddenSelection() })!,
        }
    })
    expect([...destination.children].map((node) => (node as HTMLElement).dataset.graphId)).toEqual([
        "rating:ratings",
        "fsrs:daily-logLoss",
    ])
    favorites.target.set(null)
    expect(home.childElementCount).toBe(2)
    favorites.target.set(destination)
    nodes.forEach(({ action }) => action.destroy())
    expect(destination.childElementCount).toBe(0)
    expect(home.childNodes).toHaveLength(0)
})

test("a category copy stays at home while the managed favorite moves above the charts", () => {
    const favorites = createGraphFavorites(["rating:ratings"], async () => {})
    document.body.innerHTML =
        '<div id="home"><section data-graph-id="rating:ratings"></section></div><div id="favorites"></div>'
    const graph = document.querySelector<HTMLElement>("section")!
    favorites.target.set(document.querySelector("#favorites"))
    const action = placeFavoriteGraph(graph, {
        id: "rating:ratings",
        favorites,
        hidden: hiddenSelection(),
        relocate: false,
    })
    expect(action).toBeUndefined()
    expect(graph.parentElement!.id).toBe("home")
    expect(document.querySelector("#favorites")!.childElementCount).toBe(0)
})

test("Favorites sit below native search controls and above native graphs, with clean teardown", () => {
    document.body.innerHTML =
        '<main><form></form><div class="graphs-container"></div></main><div id="addon"><section id="favorites"></section></div>'
    const favorites = document.querySelector<HTMLElement>("#favorites")!
    const action = aboveNativeGraphs(favorites)
    expect([...document.querySelector("main")!.children].map((node) => node.tagName)).toEqual([
        "FORM",
        "SECTION",
        "DIV",
    ])
    action.destroy()
    expect(document.querySelector("#favorites")).toBeNull()
    expect(document.querySelector("#addon")!.childNodes).toHaveLength(0)
})

test("Favorites wait for Anki's graphs when the native page mounts later", async () => {
    const favorites = document.createElement("section")
    document.body.append(favorites)
    const action = aboveNativeGraphs(favorites)
    const native = document.createElement("div")
    native.className = "graphs-container"
    document.body.append(native)
    await Promise.resolve()
    expect(favorites.nextElementSibling).toBe(native)
    action.destroy()
})
