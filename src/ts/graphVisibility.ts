import { getContext } from "svelte"
import { derived, readable, type Readable } from "svelte/store"
import { GRAPH_CATEGORY_VISIBLE } from "./graphFavorites"
import { favoriteGraphs } from "./stores"

/** Availability for a graph's own requests when its category is collapsed. */
export function graphVisibility(...ids: string[]) {
    const category = getContext<Readable<boolean>>(GRAPH_CATEGORY_VISIBLE) ?? readable(true)
    return derived(
        [category, favoriteGraphs.pinned],
        ([visible, pinned]) => visible || ids.some((id) => pinned.includes(id))
    )
}
