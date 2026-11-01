<script lang="ts">
    import { FSRS_COMPARISON_COLOUR, RWKV_COMPARISON_COLOUR } from "./graph"
    import { i18n } from "./i18n"
    import LineGraph from "./LineGraph.svelte"
    import type { LineChartSeries } from "./LineGraph"
    import { recallGainPerHundredReviews } from "./memorisedPerReview"
    import type { AveragingMode } from "./dailyMovingAverage"
    import type { ReviewWindowSeries } from "./reviewRecall"
    import AveragingControls from "./AveragingControls.svelte"
    import MemorisedSourceControls from "./MemorisedSourceControls.svelte"
    import { onDestroy } from "svelte"
    import { getRwkvReviewGainWindow } from "./search"
    import { runStatsTask } from "./statsWorkerClient"
    import {
        anchoredRwkvDays,
        cancelRwkvReviewGainComputation,
        card_data,
        fsrsPresetData,
        memorisedPerReviewMode,
        memorised_stats,
        revlogs,
        reviewGainHorizon,
        rwkvReviewGainStats,
    } from "./stores"
    import { TREND_PERSISTENCE_KEYS } from "./trendPersistenceKeys"
    import Warning from "./Warning.svelte"

    let smoothing = true
    let averageDays = 7
    let averageReviews = 1000
    let averagingMode: AveragingMode = "calendar"
    let connectGaps = true
    let fsrsWindow: ReviewWindowSeries | undefined
    let rwkvWindow: ReviewWindowSeries | undefined
    let fsrsWindowError = ""
    let rwkvWindowError = ""
    let fsrsWindowRequest: AbortController | undefined
    let rwkvWindowGeneration = 0
    let view: "recall" | "gain" = "recall"
    let displayData: number[] = []
    let displaySeries: LineChartSeries[] = []
    let hasDisplayData = false
    let loadingSelectedSource = false

    const valueFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
    const formatValue = (value: number) => valueFormat.format(value)

    $: {
        const history = $revlogs
        const cards = $card_data
        const presets = $fsrsPresetData
        const stats = $memorised_stats
        const horizon = $reviewGainHorizon
        const count = averageReviews
        const needed =
            smoothing && averagingMode === "reviews" && $memorisedPerReviewMode !== "rwkv"
        fsrsWindowRequest?.abort()
        fsrsWindowRequest = undefined
        fsrsWindow = undefined
        fsrsWindowError = ""
        if (needed && history && cards && presets && stats) {
            const request = new AbortController()
            fsrsWindowRequest = request
            void runStatsTask(
                "fsrsReviewWindow",
                [
                    history,
                    cards,
                    SSEother.deck_configs,
                    SSEother.deck_config_ids,
                    presets.presetsByCard,
                    horizon,
                    count,
                    stats.snapshotNow,
                ],
                request.signal
            ).then(
                (result) => {
                    if (!request.signal.aborted) fsrsWindow = result
                },
                (error) => {
                    if (!request.signal.aborted)
                        fsrsWindowError = error instanceof Error ? error.message : String(error)
                }
            )
        }
    }
    $: {
        const stats = $rwkvReviewGainStats
        const count = averageReviews
        const needed =
            smoothing && averagingMode === "reviews" && $memorisedPerReviewMode !== "fsrs"
        const generation = ++rwkvWindowGeneration
        rwkvWindow = undefined
        rwkvWindowError = ""
        if (
            needed &&
            stats?.done &&
            !stats.error &&
            stats.phase === "complete" &&
            stats.jobId !== null
        ) {
            void getRwkvReviewGainWindow(stats.jobId, count).then(
                (result) => {
                    if (generation !== rwkvWindowGeneration) return
                    rwkvWindow = {
                        withReview: anchoredRwkvDays(result.withByDay, result.firstDay),
                        withoutReview: anchoredRwkvDays(result.withoutByDay, result.firstDay),
                        gain: anchoredRwkvDays(result.gainByDay, result.firstDay),
                    }
                },
                (error) => {
                    if (generation === rwkvWindowGeneration)
                        rwkvWindowError = error instanceof Error ? error.message : String(error)
                }
            )
        }
    }
    $: reviewWindowLoading =
        smoothing &&
        averagingMode === "reviews" &&
        (($memorisedPerReviewMode !== "rwkv" && !fsrsWindow && !fsrsWindowError) ||
            ($memorisedPerReviewMode !== "fsrs" &&
                !rwkvWindow &&
                !rwkvWindowError &&
                !$rwkvReviewGainStats?.error &&
                $rwkvReviewGainStats?.phase !== "cancelled"))
    $: windowLabel = i18n(
        averagingMode === "reviews"
            ? "averaging-review-window"
            : averagingMode === "study"
              ? "averaging-study-window"
              : "averaging-calendar-window",
        { count: averagingMode === "reviews" ? averageReviews : averageDays }
    )
    onDestroy(() => {
        fsrsWindowRequest?.abort()
        rwkvWindowGeneration++
    })

    $: {
        const fsrs = $memorised_stats?.reviewRecallByHorizon[$reviewGainHorizon]
        const rwkv = $rwkvReviewGainStats
        const sources =
            $memorisedPerReviewMode === "both"
                ? [
                      {
                          label: i18n("memorised-source-fsrs"),
                          totals: fsrs,
                          window: fsrsWindow,
                          color: FSRS_COMPARISON_COLOUR,
                      },
                      {
                          label: i18n("memorised-source-rwkv"),
                          totals: rwkv && {
                              gain: rwkv.gainDays,
                              count: rwkv.countDays,
                              withReview: rwkv.withDays,
                              withoutReview: rwkv.withoutDays,
                          },
                          window: rwkvWindow,
                          color: RWKV_COMPARISON_COLOUR,
                          dailyDash: "3 3",
                      },
                  ]
                : $memorisedPerReviewMode === "rwkv"
                  ? [
                        {
                            label: i18n("memorised-source-rwkv"),
                            totals: rwkv && {
                                gain: rwkv.gainDays,
                                count: rwkv.countDays,
                                withReview: rwkv.withDays,
                                withoutReview: rwkv.withoutDays,
                            },
                            window: rwkvWindow,
                            color: RWKV_COMPARISON_COLOUR,
                            dailyDash: "3 3",
                        },
                    ]
                  : [
                        {
                            label: i18n("memorised-source-fsrs"),
                            totals: fsrs,
                            window: fsrsWindow,
                            color: FSRS_COMPARISON_COLOUR,
                        },
                    ]

        displaySeries = sources.flatMap(({ label, totals, window, color, dailyDash }) => {
            const count = totals?.count ?? []
            if (view === "recall") {
                return [
                    {
                        key: "withReview" as const,
                        text: i18n("memorised-review-with"),
                        dash: undefined,
                    },
                    {
                        key: "withoutReview" as const,
                        text: i18n("memorised-review-without"),
                        dash: "5 3",
                    },
                ].map(({ key, text, dash }) => ({
                    label: `${label} — ${text}`,
                    data:
                        smoothing && averagingMode === "reviews"
                            ? (window?.[key] ?? [])
                            : recallGainPerHundredReviews(
                                  totals?.[key] ?? [],
                                  count,
                                  smoothing ? averageDays : 1,
                                  smoothing && averagingMode === "study" ? "study" : "calendar"
                              ),
                    color,
                    strokeWidth: 2.4,
                    strokeDasharray: dash,
                    connectGaps: smoothing && connectGaps,
                }))
            }
            const raw = recallGainPerHundredReviews(totals?.gain ?? [], count)
            const average =
                averagingMode === "reviews"
                    ? (window?.gain ?? [])
                    : recallGainPerHundredReviews(
                          totals?.gain ?? [],
                          count,
                          averageDays,
                          averagingMode
                      )
            return smoothing
                ? [
                      {
                          label: i18n("averaging-series", { label, window: windowLabel }),
                          data: average,
                          color,
                          strokeWidth: 2.4,
                          connectGaps,
                      },
                      {
                          label: i18n("memorised-daily-series", { label }),
                          data: raw,
                          color: "#888",
                          opacity: 0.35,
                          strokeWidth: 1.5,
                          strokeDasharray: dailyDash,
                          renderOrder: -1,
                          legend: false,
                          includeInYAxis: false,
                      },
                  ]
                : [{ label, data: raw, color }]
        })
        displayData = displaySeries.find((series) => series.data.some(Number.isFinite))?.data ?? []
        hasDisplayData = displaySeries.some((series) => series.data.some(Number.isFinite))
        loadingSelectedSource =
            $memorisedPerReviewMode !== "fsrs" &&
            (!$rwkvReviewGainStats || (!$rwkvReviewGainStats.done && !$rwkvReviewGainStats.error))
    }
    $: rwkvProgressPercent = $rwkvReviewGainStats?.total
        ? Math.min(
              100,
              Math.round((100 * $rwkvReviewGainStats.current) / $rwkvReviewGainStats.total)
          )
        : 0
</script>

<MemorisedSourceControls bind:mode={$memorisedPerReviewMode} showHistoryProgress={false} />
<div class="review-controls">
    <label>
        {i18n("memorised-review-horizon")}
        <select bind:value={$reviewGainHorizon}>
            <option value={0}>{i18n("memorised-review-now")}</option>
            <option value={600}>{i18n("memorised-review-10-minutes")}</option>
            <option value={3600}>{i18n("memorised-review-1-hour")}</option>
            <option value={86400}>{i18n("memorised-review-24-hours")}</option>
        </select>
    </label>
    <label>
        {i18n("memorised-review-view")}
        <select bind:value={view}>
            <option value="recall">{i18n("memorised-review-recall-view")}</option>
            <option value="gain">{i18n("memorised-review-gain-view")}</option>
        </select>
    </label>
</div>
{#if $memorisedPerReviewMode !== "fsrs" && $rwkvReviewGainStats?.slowReplay}
    <Warning always>{i18n("memorised-review-rwkv-slow-replay")}</Warning>
{/if}
{#if $memorisedPerReviewMode !== "fsrs" && $rwkvReviewGainStats?.error}
    <Warning always>{$rwkvReviewGainStats.error}</Warning>
{:else if $memorisedPerReviewMode !== "fsrs" && $rwkvReviewGainStats?.phase === "cancelled"}
    <Warning always>{i18n("memorised-review-rwkv-cancelled")}</Warning>
{:else if $memorisedPerReviewMode !== "fsrs" && $rwkvReviewGainStats && !$rwkvReviewGainStats.done}
    <div class="rwkv-progress">
        <div>
            {$rwkvReviewGainStats.phase === "waiting"
                ? i18n("memorised-review-rwkv-waiting")
                : $rwkvReviewGainStats.phase === "preparing"
                  ? i18n("memorised-review-rwkv-preparing", {
                        current: $rwkvReviewGainStats.current,
                        total: $rwkvReviewGainStats.total,
                        percent: rwkvProgressPercent,
                    })
                  : i18n("memorised-review-rwkv-progress", {
                        current: $rwkvReviewGainStats.current,
                        total: $rwkvReviewGainStats.total,
                        percent: rwkvProgressPercent,
                    })}
        </div>
        <progress
            max={$rwkvReviewGainStats.total || 1}
            value={$rwkvReviewGainStats.current}
            aria-label={i18n("memorised-review-rwkv-progress-label")}
        ></progress>
        <button type="button" on:click={() => cancelRwkvReviewGainComputation()}>
            {i18n("cancel")}
        </button>
    </div>
{/if}
<AveragingControls
    bind:enabled={smoothing}
    bind:mode={averagingMode}
    bind:days={averageDays}
    bind:reviews={averageReviews}
    bind:connectGaps
/>
{#if fsrsWindowError || rwkvWindowError}
    <p role="alert">{i18n("averaging-error", { error: fsrsWindowError || rwkvWindowError })}</p>
{:else if reviewWindowLoading && hasDisplayData}
    <p role="status">{i18n("averaging-review-loading")}</p>
{/if}
{#if hasDisplayData}
    <LineGraph
        data={displayData}
        series={displaySeries}
        label={i18n(
            view === "recall" ? "memorised-review-recall-axis" : "memorised-per-review-axis"
        )}
        formatY={formatValue}
        showIsolatedPoints
        includeNegative
        legendWidth={180}
        trendPersistenceKey={view === "gain" && $reviewGainHorizon === 0
            ? TREND_PERSISTENCE_KEYS.memorised.perReview
            : `${TREND_PERSISTENCE_KEYS.memorised.perReview}:${view}:${$reviewGainHorizon}`}
    />
{:else}
    <p role="status">
        {i18n(
            loadingSelectedSource || reviewWindowLoading
                ? "loading"
                : "memorised-per-review-no-data"
        )}
    </p>
{/if}
{#if smoothing}<p class="average-help">
        {i18n(
            view === "gain"
                ? "memorised-per-review-average-help"
                : "memorised-review-recall-average-help"
        )}
    </p>
    {#if connectGaps}<p class="average-help">{i18n("averaging-gap-help")}</p>{/if}
{/if}

<style>
    .review-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5em 1em;
        margin: 0.5em 0;
        font-size: 0.85em;
    }

    .review-controls label {
        display: flex;
        align-items: center;
        gap: 0.4em;
    }

    .average-help {
        font-size: 0.85em;
    }

    .rwkv-progress {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 0.35rem 0.75rem;
        align-items: center;
        margin: 0.5rem 0;
    }

    .rwkv-progress div {
        grid-column: 1 / -1;
    }

    .rwkv-progress progress {
        width: 100%;
    }
</style>
