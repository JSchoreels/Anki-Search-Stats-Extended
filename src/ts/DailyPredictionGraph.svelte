<script lang="ts">
    import {
        renderDailyPredictionGraph,
        type DailyPredictionSeries,
        type SelectedDailyPredictionSeries,
    } from "./DailyPredictionGraph"
    import type {
        DailyPredictionMetric,
        DailyPredictionPoint,
        DailyPredictionWindowValue,
    } from "./dailyPredictionData"
    import type { AveragingMode } from "./dailyMovingAverage"
    import { heldOutFsrsPredictions } from "./calibrationSamples"
    import AveragingControls from "./AveragingControls.svelte"
    import { FSRS_COMPARISON_COLOUR, RWKV_COMPARISON_COLOUR } from "./graph"
    import { i18n } from "./i18n"
    import { onDestroy } from "svelte"
    import {
        calibration_samples,
        fsrsCalibrationStats,
        revlogs,
        rwkvCalibrationStats,
        tooltipShown,
    } from "./stores"
    import { runStatsTask } from "./statsWorkerClient"
    import type { StatsHistory } from "./statsHistory"
    import { dragZoom, type ZoomRange } from "./dragZoom"
    import ZoomControls from "./ZoomControls.svelte"

    export let fsrs: DailyPredictionPoint[]
    export let rwkv: DailyPredictionPoint[]
    export let metric: DailyPredictionMetric
    export let selectedSeries: SelectedDailyPredictionSeries[] | undefined = undefined
    let svg: SVGElement | undefined
    let zoomRange: ZoomRange | undefined
    let mode: "fsrs" | "rwkv" | "both" = "both"
    let smoothing = true
    let days = 7
    let reviews = 1000
    let averagingMode: AveragingMode = "calendar"
    let connectGaps = true
    let reviewValues: Record<string, DailyPredictionWindowValue[]> | undefined
    let reviewError = ""
    let reviewRequest: AbortController | undefined
    let reviewInputs: unknown[] | undefined

    function updateReviewValues(
        needed: boolean,
        samples: typeof $calibration_samples,
        fsrsStats: typeof $fsrsCalibrationStats,
        rwkvStats: typeof $rwkvCalibrationStats,
        history: StatsHistory | null,
        selected: SelectedDailyPredictionSeries[] | undefined,
        selectedMetric: typeof displayMetric,
        windowReviews: number
    ) {
        const unique = new Map(
            selected
                ?.filter((item) => item.data.length && item.predictions)
                .map((item) => [item.model, item.predictions!]) ?? []
        )
        const next = selected
            ? [needed, samples, history, selectedMetric, windowReviews, ...unique.entries()].flat()
            : [
                  needed,
                  samples,
                  fsrsStats?.predictions,
                  fsrsStats?.cachedPredictionCount,
                  rwkvStats?.predictions,
                  selectedMetric,
                  windowReviews,
              ]
        if (
            reviewInputs &&
            next.length === reviewInputs.length &&
            next.every((item, index) => item === reviewInputs![index])
        )
            return
        reviewInputs = next
        reviewRequest?.abort()
        reviewRequest = undefined
        reviewValues = undefined
        reviewError = ""
        if (!needed || !samples) return
        if (selected ? !history || !unique.size : !fsrsStats || !rwkvStats) return
        const request = new AbortController()
        reviewRequest = request
        const task = selected
            ? runStatsTask(
                  "dailyRecallModelReviewWindows",
                  [
                      history!,
                      samples,
                      [...unique].map(([model, predictions]) => ({ model, predictions })),
                      windowReviews,
                  ],
                  request.signal
              )
            : runStatsTask(
                  "dailyPredictionReviewWindows",
                  [
                      samples,
                      heldOutFsrsPredictions(fsrsStats!),
                      rwkvStats!.predictions,
                      selectedMetric,
                      windowReviews,
                  ],
                  request.signal
              )
        void task.then(
            (result) => {
                if (!request.signal.aborted) reviewValues = result
            },
            (error) => {
                if (!request.signal.aborted)
                    reviewError = error instanceof Error ? error.message : String(error)
            }
        )
    }
    $: series =
        selectedSeries ??
        ([
            { model: "fsrs", data: fsrs },
            { model: "rwkv", data: rwkv },
        ].filter((item) => mode === "both" || item.model === mode) as DailyPredictionSeries[])
    $: hasData = series.some((item) => item.data.length)
    $: displayMetric = metric === "standardizedGap" ? "rawGap" : metric
    $: updateReviewValues(
        smoothing && averagingMode === "reviews",
        $calibration_samples,
        $fsrsCalibrationStats,
        $rwkvCalibrationStats,
        $revlogs,
        selectedSeries,
        displayMetric,
        reviews
    )
    $: loadingReviews =
        smoothing &&
        averagingMode === "reviews" &&
        (selectedSeries === undefined || hasData) &&
        !reviewValues &&
        !reviewError
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

{#if selectedSeries === undefined}
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
        {i18n("daily-prediction-no-data", {
            model: item.label ?? i18n(`calibration-source-${item.model}`),
        })}
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
        <p class="average-help">
            {i18n(
                selectedSeries
                    ? "daily-prediction-model-average-help"
                    : "daily-prediction-average-help"
            )}
        </p>
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
