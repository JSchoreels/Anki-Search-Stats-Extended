import { derived, get, writable } from "svelte/store"
import { createGraphPreference, type HiddenGraphs } from "./graphPreferences"

export const GRAPH_CATEGORY_VISIBLE = Symbol("graph-category-visible")

export function createGraphFavorites(initial: unknown, save: (ids: string[]) => Promise<void>) {
    const { ids: pinned, toggle } = createGraphPreference(
        initial,
        save,
        "Failed to save favorite graphs"
    )
    const target = writable<HTMLElement | null>(null)
    return { pinned, target, toggle }
}

export type GraphFavorites = ReturnType<typeof createGraphFavorites>

/** Move the live card, preserving its Svelte state and its original return position. */
export function placeFavoriteGraph(
    node: HTMLElement,
    options: { id: string; favorites: GraphFavorites; hidden: HiddenGraphs }
) {
    if (!options.id) return
    const home = document.createComment("graph-home")
    node.before(home)
    let id = options.id
    const { pinned, target } = options.favorites
    const hiddenIds = options.hidden.ids
    const hiddenTarget = options.hidden.target
    function move(parent: Node, next: Node | null) {
        if (node.parentNode === parent && node.nextSibling === next) return
        const focused = node.contains(document.activeElement)
            ? (document.activeElement as HTMLElement)
            : null
        parent.insertBefore(node, next)
        focused?.focus({ preventScroll: true })
    }
    function place([pins, favoritesTarget, hidden, hiddenDestination]: [
        string[],
        HTMLElement | null,
        string[],
        HTMLElement | null,
    ]) {
        const isHidden = hidden.includes(id)
        const ids = isHidden ? hidden : pins
        const destination = isHidden ? hiddenDestination : favoritesTarget
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
    const stop = derived([pinned, target, hiddenIds, hiddenTarget], (values) => values).subscribe(
        place
    )
    return {
        update(next: typeof options) {
            id = next.id
            place([get(pinned), get(target), get(hiddenIds), get(hiddenTarget)])
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
