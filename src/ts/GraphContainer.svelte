<script lang="ts">
    import { getContext } from "svelte"
    import { readable, type Readable } from "svelte/store"
    import { GRAPH_CATEGORY_VISIBLE } from "./graphFavorites"
    import { graphIsVisible } from "./graphPreferences"
    import { favoriteGraphs, hiddenGraphs, showHiddenGraphs } from "./stores"
    import GraphCard from "./GraphCard.svelte"

    export let graphId = ""
    const categoryVisible = getContext<Readable<boolean>>(GRAPH_CATEGORY_VISIBLE) ?? readable(true)
    const { pinned: pinnedGraphs } = favoriteGraphs
    const { ids: hiddenIds } = hiddenGraphs
    $: pinned = $pinnedGraphs.includes(graphId)
    $: hidden = $hiddenIds.includes(graphId)
    $: visible =
        !graphId ||
        graphIsVisible(graphId, $categoryVisible, $pinnedGraphs, $hiddenIds, $showHiddenGraphs)
</script>

<div class="graph-position">
    {#if visible}
        <GraphCard {graphId}><slot /></GraphCard>
    {/if}
    {#if graphId && pinned && !hidden && $categoryVisible}
        <GraphCard {graphId} relocate={false}><slot /></GraphCard>
    {/if}
</div>

<style>
    .graph-position {
        display: contents;
    }
</style>
