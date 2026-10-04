<script lang="ts">
    import GraphContainer from "./GraphContainer.svelte"
    import { i18n } from "./i18n"
    import type { CurrentDisagreementResponse } from "./currentDisagreementData"
    import { buildCurrentRetrievabilityBins } from "./currentRetrievabilityData"
    import {
        CURRENT_RETRIEVABILITY_SERIES,
        CURRENT_RETRIEVABILITY_SHIFT_SERIES,
        currentRetrievabilityShiftLabel,
        renderCurrentRetrievabilityGraph,
    } from "./CurrentRetrievabilityGraph"

    export let response: CurrentDisagreementResponse | null = null
    export let retry: () => void

    let svg: SVGElement | undefined
    let colorByBucketShift = false
    const shiftLegendRows = [
        CURRENT_RETRIEVABILITY_SHIFT_SERIES.filter(({ shift }) => shift <= 0),
        CURRENT_RETRIEVABILITY_SHIFT_SERIES.filter(({ shift }) => shift > 0),
    ]
    $: bins = buildCurrentRetrievabilityBins(response?.rows ?? [])
    $: paired = bins.reduce((sum, bin) => sum + bin.both.length + bin.rwkv.length, 0)
    $: if (svg) renderCurrentRetrievabilityGraph(svg, bins, { colorByBucketShift })
</script>

<GraphContainer>
    <h1>{i18n("current-retrievability")}</h1>
    {#if !response || response.status === "pending"}
        <p>{i18n("loading")}</p>
    {:else if response.status !== "ready"}
        <p>{i18n(`current-disagreement-${response.status}`)}</p>
        <button on:click={retry}>{i18n("current-disagreement-retry")}</button>
    {:else if paired}
        <label class="shift-toggle">
            <input type="checkbox" bind:checked={colorByBucketShift} />
            {i18n("current-retrievability-color-by-shift")}
        </label>
        <svg bind:this={svg}></svg>
        <div class="legend" class:shift-legend={colorByBucketShift}>
            {#if colorByBucketShift}
                <span class="legend-title">{i18n("current-retrievability-shift-legend")}</span>
                {#each shiftLegendRows as row}
                    <div class="legend-row">
                        {#each row as { shift, color }}
                            <span class="legend-item">
                                <span class="swatch" style:background={color}></span>
                                {currentRetrievabilityShiftLabel(shift)}
                            </span>
                        {/each}
                    </div>
                {/each}
            {:else}
                {#each CURRENT_RETRIEVABILITY_SERIES as { key, color }}
                    <span class="legend-item">
                        <span class="swatch" style:background={color}></span>
                        {i18n(`current-retrievability-${key}`)}
                    </span>
                {/each}
            {/if}
        </div>
    {:else}
        <p>{i18n("current-disagreement-no-data")}</p>
    {/if}
    {#if response?.status === "ready"}
        <p>{i18n("current-disagreement-count", { count: paired, total: response.total })}</p>
    {/if}
    <p>
        {i18n(
            colorByBucketShift ? "current-retrievability-shift-help" : "current-retrievability-help"
        )}
    </p>
</GraphContainer>

<style lang="scss">
    .shift-toggle {
        align-self: flex-start;
        font-size: small;
    }

    .legend {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 1rem;
        font-size: small;
    }

    .shift-legend {
        flex-direction: column;
        gap: 0.5rem;
    }

    .legend-title {
        text-align: center;
    }

    .legend-row {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 1rem;
    }

    .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
    }

    .swatch {
        width: 0.8rem;
        height: 0.8rem;
    }
</style>
