import { derived, get, writable } from "svelte/store"

export const GRAPH_CATEGORY_VISIBLE = Symbol("graph-category-visible")

export function normalizePinnedGraphs(value: unknown): string[] {
    return Array.isArray(value)
        ? [
              ...new Set(
                  value.filter((id): id is string => typeof id === "string" && id.includes(":"))
              ),
          ]
        : []
}

export function categoryHasPinnedGraphs(pinned: string[], category: string) {
    return pinned.some((id) => id.startsWith(`${category}:`))
}

export function createGraphFavorites(initial: unknown, save: (ids: string[]) => Promise<void>) {
    const pinned = writable(normalizePinnedGraphs(initial))
    const target = writable<HTMLElement | null>(null)
    let writes = Promise.resolve()

    function toggle(id: string): Promise<boolean> {
        const result = writes.then(async () => {
            const previous = get(pinned)
            const next = previous.includes(id)
                ? previous.filter((item) => item !== id)
                : [...previous, id]
            try {
                await save(next)
                pinned.set(next)
                return true
            } catch (error) {
                console.warn("Failed to save favorite graphs", error)
                return false
            }
        })
        writes = result.then(() => undefined)
        return result
    }

    return { pinned, target, toggle }
}

export type GraphFavorites = ReturnType<typeof createGraphFavorites>

/** Move the live card, preserving its Svelte state and its original return position. */
export function placeFavoriteGraph(
    node: HTMLElement,
    options: { id: string; favorites: GraphFavorites }
) {
    if (!options.id) return
    const home = document.createComment("graph-home")
    node.before(home)
    let id = options.id
    const { pinned, target } = options.favorites
    function move(parent: Node, next: Node | null) {
        if (node.parentNode === parent && node.nextSibling === next) return
        const focused = node.contains(document.activeElement)
            ? (document.activeElement as HTMLElement)
            : null
        parent.insertBefore(node, next)
        focused?.focus({ preventScroll: true })
    }
    function place([ids, destination]: [string[], HTMLElement | null]) {
        const index = ids.indexOf(id)
        if (index >= 0 && destination) {
            const next = Array.from(destination.children).find(
                (child) => ids.indexOf((child as HTMLElement).dataset.graphId ?? "") > index
            )
            move(destination, next ?? null)
        } else {
            if (home.parentNode) move(home.parentNode, home.nextSibling)
        }
    }
    const stop = derived([pinned, target], (values) => values).subscribe(place)
    return {
        update(next: typeof options) {
            id = next.id
            place([get(pinned), get(target)])
        },
        destroy() {
            stop()
            node.remove()
            home.remove()
        },
    }
}

/** Keep native search/range controls above Favorites and native charts below it. */
export function aboveNativeGraphs(node: HTMLElement) {
    const home = document.createComment("favorites-home")
    node.before(home)
    function place() {
        const graphs = document.querySelector(".graphs-container")
        if (!graphs) return false
        graphs.before(node)
        return true
    }
    const observer = new MutationObserver(() => {
        if (place()) observer.disconnect()
    })
    if (!place()) observer.observe(document.body, { childList: true, subtree: true })
    return {
        destroy() {
            observer.disconnect()
            node.remove()
            home.remove()
        },
    }
}
