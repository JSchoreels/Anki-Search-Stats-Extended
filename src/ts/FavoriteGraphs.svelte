<script lang="ts">
    import { aboveNativeGraphs } from "./graphFavorites"
    import { defaultGraphBounds } from "./graph"
    import { i18n } from "./i18n"
    import { favoriteGraphs } from "./stores"

    const { pinned, target } = favoriteGraphs
    const { width, height } = defaultGraphBounds()
    function graphTarget(node: HTMLElement) {
        target.set(node)
        return { destroy: () => target.set(null) }
    }
</script>

<div class="favorites-position">
    <section
        class="favorites"
        hidden={!$pinned.length}
        aria-label={i18n("favorite-graphs")}
        style:--graph-width={`${width}px`}
        style:--graph-height={`${height}px`}
        use:aboveNativeGraphs
    >
        <h1>{i18n("favorite-graphs")}</h1>
        <div class="favorites-grid" use:graphTarget></div>
    </section>
</div>

<style lang="scss">
    @use "./graphGrid.scss" as *;
    .favorites-position {
        display: contents;
    }
    .favorites[hidden] {
        display: none;
    }
    h1 {
        margin: 1.5rem;
    }
    .favorites-grid {
        @include graph-grid;
        margin-bottom: 1.5rem;
    }
</style>
