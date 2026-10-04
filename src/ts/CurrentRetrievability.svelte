<script lang="ts">
    import GraphContainer from "./GraphContainer.svelte"
    import { i18n } from "./i18n"
    import type { CurrentDisagreementResponse } from "./currentDisagreementData"
    import { buildCurrentRetrievabilityBins } from "./currentRetrievabilityData"
    import {
        CURRENT_RETRIEVABILITY_SERIES,
        renderCurrentRetrievabilityGraph,
    } from "./CurrentRetrievabilityGraph"

    export let response: CurrentDisagreementResponse | null = null
    export let retry: () => void

    let svg: SVGElement | undefined
    $: bins = buildCurrentRetrievabilityBins(response?.rows ?? [])
    $: paired = bins.reduce((sum, bin) => sum + bin.both.length + bin.rwkv.length, 0)
    $: if (svg) renderCurrentRetrievabilityGraph(svg, bins)
</script>

<GraphContainer>
    <h1>{i18n("current-retrievability")}</h1>
    {#if !response || response.status === "pending"}
        <p>{i18n("loading")}</p>
    {:else if response.status !== "ready"}
        <p>{i18n(`current-disagreement-${response.status}`)}</p>
        <button on:click={retry}>{i18n("current-disagreement-retry")}</button>
    {:else if paired}
        <svg bind:this={svg}></svg>
        <div class="legend">
            {#each CURRENT_RETRIEVABILITY_SERIES as { key, color }}
                <span>
                    <span class="swatch" style:background={color}></span>
                    {i18n(`current-retrievability-${key}`)}
                </span>
            {/each}
        </div>
    {:else}
        <p>{i18n("current-disagreement-no-data")}</p>
    {/if}
    {#if response?.status === "ready"}
        <p>{i18n("current-disagreement-count", { count: paired, total: response.total })}</p>
    {/if}
    <p>{i18n("current-retrievability-help")}</p>
</GraphContainer>

<style lang="scss">
    .legend {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 1rem;
        font-size: small;
    }

    .legend > span {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
    }

    .swatch {
        width: 0.8rem;
        height: 0.8rem;
    }
</style>
