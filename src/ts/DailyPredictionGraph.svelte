<script lang="ts">
    import { renderDailyPredictionGraph, type DailyPredictionSeries } from "./DailyPredictionGraph"
    import type { DailyPredictionMetric, DailyPredictionPoint } from "./dailyPredictionData"
    import type { AveragingMode } from "./dailyMovingAverage"
    import { heldOutFsrsPredictions } from "./calibrationSamples"
    import AveragingControls from "./AveragingControls.svelte"
    import { FSRS_COMPARISON_COLOUR, RWKV_COMPARISON_COLOUR } from "./graph"
    import { i18n } from "./i18n"
    import { onDestroy } from "svelte"
    import {
        calibration_samples,
        fsrsCalibrationStats,
        rwkvCalibrationStats,
        tooltipShown,
    } from "./stores"
    import { runStatsTask } from "./statsWorkerClient"
    import type { Tasks } from "./statsTasks"
    import { dragZoom, type ZoomRange } from "./dragZoom"
    import ZoomControls from "./ZoomControls.svelte"

    export let fsrs: DailyPredictionPoint[]
    export let rwkv: DailyPredictionPoint[]
    export let metric: DailyPredictionMetric
    let svg: SVGElement | undefined
    let zoomRange: ZoomRange | undefined
    let mode: "fsrs" | "rwkv" | "both" = "both"
    let showRawGap = false
    let smoothing = true
    let days = 7
    let reviews = 1000
    let averagingMode: AveragingMode = "calendar"
    let connectGaps = true
    let reviewValues: ReturnType<Tasks["dailyPredictionReviewWindows"]> | undefined
    let reviewError = ""
    let reviewRequest: AbortController | undefined

    function requestReviewValues(
        samples: NonNullable<typeof $calibration_samples>,
        fsrsStats: NonNullable<typeof $fsrsCalibrationStats>,
        rwkvStats: NonNullable<typeof $rwkvCalibrationStats>,
        selectedMetric: typeof displayMetric,
        windowReviews: number
    ) {
        const request = new AbortController()
        reviewRequest = request
        void runStatsTask(
            "dailyPredictionReviewWindows",
            [
                samples,
                heldOutFsrsPredictions(fsrsStats),
                rwkvStats.predictions,
                selectedMetric,
                windowReviews,
            ],
            request.signal
        ).then(
            (result) => {
                if (!request.signal.aborted) reviewValues = result
            },
            (error) => {
                if (!request.signal.aborted)
                    reviewError = error instanceof Error ? error.message : String(error)
            }
        )
    }
    $: series = [
        { model: "fsrs", data: fsrs },
        { model: "rwkv", data: rwkv },
    ].filter((item) => mode === "both" || item.model === mode) as DailyPredictionSeries[]
    $: hasData = series.some((item) => item.data.length)
    $: displayMetric = metric === "standardizedGap" && showRawGap ? "rawGap" : metric
    $: {
        const samples = $calibration_samples
        const fsrsStats = $fsrsCalibrationStats
        const rwkvStats = $rwkvCalibrationStats
        const needsReviews = smoothing && averagingMode === "reviews"
        const selectedMetric = displayMetric
        const windowReviews = reviews
        reviewRequest?.abort()
        reviewRequest = undefined
        reviewValues = undefined
        reviewError = ""
        if (needsReviews && samples && fsrsStats && rwkvStats)
            requestReviewValues(samples, fsrsStats, rwkvStats, selectedMetric, windowReviews)
    }
    $: loadingReviews = smoothing && averagingMode === "reviews" && !reviewValues && !reviewError
    $: zoomOptions =
        svg && !loadingReviews
            ? renderDailyPredictionGraph(
                  svg,
                  series,
                  displayMetric,
                  smoothing ? (averagingMode === "reviews" ? reviews : days) : null,
                  zoomRange,
                  (range) => {
                      zoomRange = range
                  },
                  { mode: averagingMode, reviewValues, connectGaps }
              )
            : undefined
    onDestroy(() => {
        reviewRequest?.abort()
        tooltipShown.set(false)
    })
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
{#if metric === "standardizedGap"}
    <div class="daily-controls">
        <label>
            <input type="checkbox" bind:checked={showRawGap} />
            {i18n("daily-prediction-show-raw-gap")}
        </label>
    </div>
{/if}
<AveragingControls
    bind:enabled={smoothing}
    bind:mode={averagingMode}
    bind:days
    bind:reviews
    bind:connectGaps
/>
{#each series.filter((item) => !item.data.length) as item}
    <p role="status">
        {i18n("daily-prediction-no-data", { model: i18n(`calibration-source-${item.model}`) })}
    </p>
{/each}
{#if reviewError && smoothing && averagingMode === "reviews"}
    <p role="alert">{i18n("averaging-error", { error: reviewError })}</p>
{:else if loadingReviews}
    <p role="status">{i18n("loading")}</p>
{:else if hasData}
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
    {#if smoothing}
        <p class="average-help">{i18n("daily-prediction-average-help")}</p>
        {#if connectGaps}<p class="average-help">{i18n("averaging-gap-help")}</p>{/if}
    {/if}
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
    .model-color {
        width: 0.7em;
        height: 0.7em;
        border-radius: 2px;
    }
    .average-help {
        font-size: 0.85em;
    }
</style>
