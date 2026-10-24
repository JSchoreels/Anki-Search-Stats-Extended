<script lang="ts">
    import type { CATEGORIES } from "./categories"
    import { derived } from "svelte/store"
    import { setContext } from "svelte"
    import { categoryHasPinnedGraphs, GRAPH_CATEGORY_VISIBLE } from "./graphFavorites"
    import { favoriteGraphs, shownCategories } from "./stores"

    // If falsy, Disables hide button
    export let hidden_title = ""
    export let config_name: keyof typeof CATEGORIES | "graphOrder"

    const { pinned: pinnedGraphs } = favoriteGraphs
    const categoryVisible = derived(
        shownCategories,
        (categories) =>
            categories[config_name] !== "removed" &&
            (!hidden_title || categories[config_name] !== false)
    )
    setContext(GRAPH_CATEGORY_VISIBLE, categoryVisible)
    $: hidden = $shownCategories[config_name] === false
    $: removed = $shownCategories[config_name] === "removed"
    $: hasFavorites = categoryHasPinnedGraphs($pinnedGraphs, config_name)
</script>

{#if !removed || hasFavorites}
    {#if !removed}
        <label>
            <div class={`separator ${hidden ? "hidden" : ""}`}>
                {#if hidden_title}
                    <button
                        class="btn"
                        on:click={() => {
                            $shownCategories[config_name] = hidden
                        }}
                    >
                        &gt;
                    </button>
                    {#if hidden}
                        <h3>{hidden_title}...</h3>
                    {/if}
                {/if}
                <hr />
            </div>
        </label>
    {/if}
    <div class="category" hidden={!$categoryVisible}>
        {#if $categoryVisible || hasFavorites}
            <slot />
        {/if}
    </div>
{/if}

<style lang="scss">
    @use "./graphGrid.scss" as *;
    label {
        display: contents;
    }

    div.separator {
        display: flex;
        align-items: center;
        opacity: 0.5;
    }

    div button,
    div button:hover {
        font-weight: 900;
        font-size: xx-large;

        background: none;
        border: none;
        border-radius: none;

        transform: rotate(90deg);
        transition: transform 0.5s ease-in-out;
    }

    div.hidden button {
        transform: rotate(0deg);
    }

    button,
    hr,
    h3 {
        margin: 1rem 0.5rem;
    }

    hr {
        flex-grow: 1;
        opacity: 1;
    }

    // Copied from anki/ts/graphs/GraphsPage.svelte
    div.category {
        @include graph-grid;
        &[hidden] {
            display: none;
        }
    }
</style>
