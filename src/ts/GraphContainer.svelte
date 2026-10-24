<script lang="ts">
    import { getContext } from "svelte"
    import { readable, type Readable } from "svelte/store"
    import { GRAPH_CATEGORY_VISIBLE, placeFavoriteGraph } from "./graphFavorites"
    import { graphIsVisible } from "./graphPreferences"
    import { i18n } from "./i18n"
    import { favoriteGraphs, hiddenGraphs, showHiddenGraphs } from "./stores"

    export let graphId = ""
    const categoryVisible = getContext<Readable<boolean>>(GRAPH_CATEGORY_VISIBLE) ?? readable(true)
    const { pinned: pinnedGraphs } = favoriteGraphs
    const { ids: hiddenIds } = hiddenGraphs
    let saving = false
    let failure = ""
    $: pinned = $pinnedGraphs.includes(graphId)
    $: hidden = $hiddenIds.includes(graphId)
    $: visible =
        !graphId ||
        graphIsVisible(graphId, $categoryVisible, $pinnedGraphs, $hiddenIds, $showHiddenGraphs)

    async function togglePin() {
        if (saving) return
        saving = true
        failure = (await favoriteGraphs.toggle(graphId)) ? "" : "graph-pin-save-failed"
        saving = false
    }

    async function toggleHidden() {
        if (saving) return
        saving = true
        failure = (await hiddenGraphs.toggle(graphId)) ? "" : "graph-hide-save-failed"
        saving = false
    }
</script>

<div class="graph-position">
    {#if visible}
        <div
            class="container graph"
            class:pinnable={!!graphId}
            data-graph-id={graphId || undefined}
            use:placeFavoriteGraph={{
                id: graphId,
                favorites: favoriteGraphs,
                hidden: hiddenGraphs,
            }}
        >
            {#if graphId}
                <div class="graph-actions">
                    <button
                        class="graph-hide"
                        type="button"
                        aria-busy={saving}
                        title={i18n(hidden ? "graph-unhide-help" : "graph-hide-help")}
                        on:click={toggleHidden}
                    >
                        {i18n(hidden ? "graph-unhide" : "graph-hide")}
                    </button>
                    <button
                        class="graph-pin"
                        class:pinned
                        type="button"
                        aria-pressed={pinned}
                        aria-label={i18n(pinned ? "graph-unpin" : "graph-pin")}
                        title={i18n(pinned ? "graph-unpin" : "graph-pin")}
                        aria-busy={saving}
                        on:click={togglePin}
                    >
                        <span aria-hidden="true">{pinned ? "★" : "☆"}</span>
                    </button>
                </div>
                {#if failure}<small role="alert">{i18n(failure)}</small>{/if}
            {/if}
            <slot />
        </div>
    {/if}
</div>

<style lang="scss">
    @use "../../anki/ts/lib/sass/elevation.scss" as *;
    .graph-position {
        display: contents;
    }
    .graph-actions {
        position: absolute;
        right: 0.7em;
        top: 0.7em;
        display: flex;
        align-items: center;
        gap: 0.4em;
        @media print {
            display: none;
        }
    }
    .graph-hide {
        font-size: 0.8em;
        cursor: pointer;
    }
    .graph-pin {
        background: transparent;
        border: 1px solid transparent;
        font-size: 1.4em;
        line-height: 1;
        padding: 0.25em;
        color: inherit;
        cursor: pointer;
        &.pinned {
            color: #d99822;
        }
        &[aria-busy="true"] {
            opacity: 0.5;
            cursor: progress;
        }
        &:hover,
        &:focus-visible {
            border-color: var(--border);
            border-radius: 4px;
        }
        @media print {
            display: none;
        }
    }
    // Copied from anki/ts/graphs/Graph.svelte
    .graph {
        /* See graph-styles.ts for constants referencing global styles */

        // OMITTED GLOBAL DEFINITIONS FOR DUPLICATION REASONS

        /* Customizing the standard x and y tick markers and text on the graphs.
         * The `tick` class is automatically added by d3. */
        &:focus {
            outline: 0;
        }
    }

    // Copied from anki/ts/graphs/TitledContainer.svelte
    .container {
        position: relative;
        width: 100%;
        background: var(--canvas-elevated);
        border: 1px solid var(--border-subtle);
        border-radius: var(--border-radius-medium, 10px);

        transition: box-shadow var(--transition) ease-in-out;
        page-break-inside: avoid;
        padding: 1em;

        display: flex;
        flex-direction: column;
        align-content: center;
        overflow: hidden;
    }

    .graph :global(p) {
        font-size: small;
        margin-top: 1em;
    }

    .graph :global(h1) {
        border-bottom: 1px var(--border) solid;
        padding-bottom: 0.25em;
    }
    .pinnable :global(h1) {
        padding-right: 4em;
    }
</style>
