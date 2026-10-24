<script lang="ts">
    import { renderDailyPredictionGraph, type DailyPredictionSeries } from "./DailyPredictionGraph"
    import type { DailyPredictionMetric, DailyPredictionPoint } from "./dailyPredictionData"
    import { FSRS_COMPARISON_COLOUR, RWKV_COMPARISON_COLOUR } from "./graph"
    import { i18n } from "./i18n"
    import { onDestroy } from "svelte"
    import { tooltipShown } from "./stores"
    import { dragZoom, type ZoomRange } from "./dragZoom"
    import ZoomControls from "./ZoomControls.svelte"

    export let fsrs: DailyPredictionPoint[]
    export let rwkv: DailyPredictionPoint[]
    export let metric: DailyPredictionMetric
    let svg: SVGElement | undefined
    let zoomRange: ZoomRange | undefined
    let mode: "fsrs" | "rwkv" | "both" = "both"
    let smoothing = true
    let days = 7
    let draftDays: number | undefined = days

    function applyDays() {
        if (typeof draftDays === "number" && Number.isSafeInteger(draftDays) && draftDays >= 1)
            days = draftDays
    }
    $: series = [
        { model: "fsrs", data: fsrs },
        { model: "rwkv", data: rwkv },
    ].filter((item) => mode === "both" || item.model === mode) as DailyPredictionSeries[]
    $: hasData = series.some((item) => item.data.length)
    $: zoomOptions = svg
        ? renderDailyPredictionGraph(
              svg,
              series,
              metric,
              smoothing ? days : null,
              zoomRange,
              (range) => {
                  zoomRange = range
              }
          )
        : undefined
    onDestroy(() => tooltipShown.set(false))
</script>

<div class="daily-controls" role="group" aria-label={i18n("calibration-source")}>
    {#each ["fsrs", "rwkv", "both"] as source}
        <label>
            <input type="radio" value={source} bind:group={mode} />
            {#if source !== "both"}
                <span
                    class="model-color"
                    style:background-color={source === "fsrs"
                        ? FSRS_COMPARISON_COLOUR
                        : RWKV_COMPARISON_COLOUR}
                ></span>
            {/if}
            {i18n(`calibration-source-${source}`)}
        </label>
    {/each}
</div>
<div class="daily-controls">
    <label>
        <input type="checkbox" bind:checked={smoothing} />
        {i18n("daily-prediction-moving-average")}
    </label>
    <form on:submit|preventDefault={applyDays}>
        <label>
            <input
                aria-label={i18n("daily-prediction-average-days")}
                type="number"
                min="1"
                step="1"
                required
                disabled={!smoothing}
                bind:value={draftDays}
                on:change={applyDays}
            />
            {i18n("maturation-days")}
        </label>
    </form>
</div>
{#each series.filter((item) => !item.data.length) as item}
    <p role="status">
        {i18n("daily-prediction-no-data", { model: i18n(`calibration-source-${item.model}`) })}
    </p>
{/each}
{#if hasData}
    <ZoomControls
        zoomed={!!zoomRange}
        reset={() => {
            zoomRange = undefined
        }}
    />
    <svg
        bind:this={svg}
        use:dragZoom={zoomOptions}
        role="img"
        aria-label={i18n(`daily-prediction-${metric}`)}
    ></svg>
    {#if smoothing}<p class="average-help">{i18n("daily-prediction-average-help")}</p>{/if}
{/if}

<style>
    .daily-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5em 1em;
        margin-bottom: 0.6em;
        font-size: 0.85em;
    }
    label {
        display: flex;
        align-items: center;
        gap: 0.4em;
    }
    input[type="number"] {
        width: 4.5em;
    }
    .model-color {
        width: 0.7em;
        height: 0.7em;
        border-radius: 2px;
    }
    .average-help {
        font-size: 0.85em;
    }
</style>
