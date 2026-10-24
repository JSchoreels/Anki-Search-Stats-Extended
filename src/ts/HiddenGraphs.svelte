<script lang="ts">
    import { i18n } from "./i18n"
    import { hiddenGraphs, showHiddenGraphs } from "./stores"

    const { ids, target } = hiddenGraphs
    function hiddenGraphTarget(node: HTMLElement) {
        target.set(node)
        return { destroy: () => target.set(null) }
    }
</script>

<section
    class="hidden-graphs"
    hidden={!$showHiddenGraphs || !$ids.length}
    aria-label={i18n("hidden-graphs")}
>
    <h1>{i18n("hidden-graphs")}</h1>
    <div class="hidden-grid" use:hiddenGraphTarget></div>
</section>

<style lang="scss">
    @use "./graphGrid.scss" as *;
    .hidden-graphs[hidden] {
        display: none;
    }
    h1 {
        margin: 1.5rem;
    }
    .hidden-grid {
        @include graph-grid;
        margin-bottom: 1.5rem;
    }
</style>
