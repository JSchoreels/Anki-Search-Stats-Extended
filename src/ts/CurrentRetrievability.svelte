<script lang="ts">
    import GraphContainer from "./GraphContainer.svelte"
    import { i18n } from "./i18n"
    import type { CurrentDisagreementResponse } from "./currentDisagreementData"
    import { buildCurrentRetrievabilityBins } from "./currentRetrievabilityData"
    import type { CurrentRetrievabilityModel } from "./currentRetrievabilityData"
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
    let groupingModel: CurrentRetrievabilityModel = "fsrs"
    const shiftLegendRows = [
        {
            label: "current-retrievability-steps-lower",
            series: CURRENT_RETRIEVABILITY_SHIFT_SERIES.filter(({ shift }) => shift < 0),
        },
        {
            label: null,
            series: CURRENT_RETRIEVABILITY_SHIFT_SERIES.filter(({ shift }) => shift === 0),
        },
        {
            label: "current-retrievability-steps-higher",
            series: CURRENT_RETRIEVABILITY_SHIFT_SERIES.filter(({ shift }) => shift > 0),
        },
    ]
    const shiftHelp = ["lower", "same", "higher", "strength", "steps", "counts"]
    $: bins = buildCurrentRetrievabilityBins(response?.rows ?? [])
    $: paired = bins.reduce((sum, bin) => sum + bin.both.length + bin.rwkv.length, 0)
    $: membershipSeries = CURRENT_RETRIEVABILITY_SERIES.filter(
        ({ key }) => key === "both" || key === groupingModel
    )
    $: if (svg)
        renderCurrentRetrievabilityGraph(svg, bins, { colorByBucketShift, model: groupingModel })
</script>

<GraphContainer graphId="fsrs:current-retrievability">
    <h1>{i18n("current-retrievability")}</h1>
    {#if !response || response.status === "pending"}
        <p>{i18n("loading")}</p>
    {:else if response.status !== "ready"}
        <p>{i18n(`current-disagreement-${response.status}`)}</p>
        <button on:click={retry}>{i18n("current-disagreement-retry")}</button>
    {:else if paired}
        <fieldset class="grouping-model">
            <legend>{i18n("current-retrievability-group-by")}</legend>
            <label>
                <input
                    type="radio"
                    name="current-retrievability-model"
                    value="fsrs"
                    bind:group={groupingModel}
                />
                FSRS
            </label>
            <label>
                <input
                    type="radio"
                    name="current-retrievability-model"
                    value="rwkv"
                    bind:group={groupingModel}
                />
                RWKV
            </label>
        </fieldset>
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
                        {#if row.label}
                            <span class="legend-direction">{i18n(row.label)}</span>
                        {/if}
                        <div class="legend-values">
                            {#each row.series as { shift, color }}
                                <span
                                    class="legend-item"
                                    title={currentRetrievabilityShiftLabel(shift)}
                                >
                                    <span class="swatch" style:background={color}></span>
                                    {#if shift === 0}
                                        {currentRetrievabilityShiftLabel(shift)}
                                    {:else}
                                        {Math.abs(shift)}{Math.abs(shift) === 5 ? "+" : ""}
                                    {/if}
                                </span>
                            {/each}
                        </div>
                    </div>
                {/each}
            {:else}
                {#each membershipSeries as { key, color }}
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
        <p>{i18n("current-retrievability-count", { count: paired, total: response.total })}</p>
    {/if}
    <ul class="reading-guide">
        <li>{i18n("current-retrievability-help-bars", { model: groupingModel.toUpperCase() })}</li>
        {#if colorByBucketShift}
            {#each shiftHelp as topic}
                <li>{i18n(`current-retrievability-shift-help-${topic}`)}</li>
            {/each}
        {:else}
            {#each membershipSeries as { key }}
                <li>{i18n(`current-retrievability-help-${key}`)}</li>
            {/each}
            <li>{i18n("current-retrievability-help-browse")}</li>
        {/if}
        <li>{i18n("current-retrievability-help-counting")}</li>
        <li>{i18n("current-retrievability-help-scope")}</li>
    </ul>
</GraphContainer>

<style lang="scss">
    .grouping-model {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        border: 0;
        padding: 0;
        margin: 0 0 0.5rem;
        font-size: small;
    }

    .grouping-model legend {
        margin-bottom: 0.25rem;
    }

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
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
    }

    .legend-direction {
        white-space: nowrap;
    }

    .legend-values {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.75rem;
    }

    .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
    }

    .swatch {
        width: 0.8rem;
        height: 0.8rem;
        flex-shrink: 0;
    }

    .reading-guide {
        font-size: small;
        line-height: 1.5;
        padding-left: 1.5rem;
    }

    .reading-guide li + li {
        margin-top: 0.35rem;
    }
</style>
