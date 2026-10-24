<script lang="ts">
    import { getContext } from "svelte"
    import { readable, type Readable } from "svelte/store"
    import { GRAPH_CATEGORY_VISIBLE, placeFavoriteGraph } from "./graphFavorites"
    import { i18n } from "./i18n"
    import { favoriteGraphs } from "./stores"

    export let graphId = ""
    const categoryVisible = getContext<Readable<boolean>>(GRAPH_CATEGORY_VISIBLE) ?? readable(true)
    const { pinned: pinnedGraphs } = favoriteGraphs
    let saving = false
    let failed = false
    $: pinned = $pinnedGraphs.includes(graphId)
    $: visible = !graphId || $categoryVisible || pinned

    async function togglePin() {
        if (saving) return
        saving = true
        failed = !(await favoriteGraphs.toggle(graphId))
        saving = false
    }
</script>

<div class="graph-position">
    {#if visible}
        <div
            class="container graph"
            class:pinnable={!!graphId}
            data-graph-id={graphId || undefined}
            use:placeFavoriteGraph={{ id: graphId, favorites: favoriteGraphs }}
        >
            {#if graphId}
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
                {#if failed}<small role="alert">{i18n("graph-pin-save-failed")}</small>{/if}
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
    .graph-pin {
        position: absolute;
        right: 0.7em;
        top: 0.7em;
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
        padding-right: 1.5em;
    }
</style>
