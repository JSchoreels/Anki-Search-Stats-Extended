<script lang="ts">
    import { aboveNativeGraphs } from "./graphFavorites"
    import { defaultGraphBounds } from "./graph"
    import { i18n } from "./i18n"
    import { favoriteGraphs, hiddenGraphs, showHiddenGraphs } from "./stores"

    const { pinned, target } = favoriteGraphs
    const { ids: hiddenIds, target: hiddenTarget } = hiddenGraphs
    $: hasVisibleFavorites = $pinned.some((id) => !$hiddenIds.includes(id))
    const { width, height } = defaultGraphBounds()
    function graphTarget(node: HTMLElement) {
        target.set(node)
        return { destroy: () => target.set(null) }
    }
    function hiddenGraphTarget(node: HTMLElement) {
        hiddenTarget.set(node)
        return { destroy: () => hiddenTarget.set(null) }
    }
</script>

<div class="favorites-position">
    <div
        class="top-graphs"
        style:--graph-width={`${width}px`}
        style:--graph-height={`${height}px`}
        use:aboveNativeGraphs
    >
        {#if $hiddenIds.length}
            <div class="visibility-controls">
                <button
                    type="button"
                    aria-pressed={$showHiddenGraphs}
                    on:click={() => showHiddenGraphs.set(!$showHiddenGraphs)}
                >
                    {i18n($showHiddenGraphs ? "hide-hidden-graphs" : "show-hidden-graphs", {
                        count: $hiddenIds.length,
                    })}
                </button>
            </div>
        {/if}
        <section
            class="hidden-graphs"
            hidden={!$showHiddenGraphs || !$hiddenIds.length}
            aria-label={i18n("hidden-graphs")}
        >
            <h1>{i18n("hidden-graphs")}</h1>
            <div class="hidden-grid" use:hiddenGraphTarget></div>
        </section>
        <section
            class="favorites"
            hidden={!hasVisibleFavorites}
            aria-label={i18n("favorite-graphs")}
        >
            <h1>{i18n("favorite-graphs")}</h1>
            <div class="favorites-grid" use:graphTarget></div>
        </section>
    </div>
</div>

<style lang="scss">
    @use "./graphGrid.scss" as *;
    .favorites-position {
        display: contents;
    }
    .favorites[hidden],
    .hidden-graphs[hidden] {
        display: none;
    }
    h1 {
        margin: 1.5rem;
    }
    .favorites-grid,
    .hidden-grid {
        @include graph-grid;
        margin-bottom: 1.5rem;
    }
    .visibility-controls {
        margin: 1rem 1.5rem;
        @media print {
            display: none;
        }
    }
</style>
