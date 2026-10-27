<script lang="ts">
    import { FSRS_COMPARISON_COLOUR, RWKV_COMPARISON_COLOUR } from "./graph"
    import { i18n } from "./i18n"
    import LineGraph from "./LineGraph.svelte"
    import type { LineChartSeries } from "./LineGraph"
    import { recallGainPerHundredReviews } from "./memorisedPerReview"
    import MemorisedSourceControls from "./MemorisedSourceControls.svelte"
    import {
        cancelRwkvReviewGainComputation,
        memorisedPerReviewMode,
        memorised_stats,
        rwkvReviewGainStats,
    } from "./stores"
    import { TREND_PERSISTENCE_KEYS } from "./trendPersistenceKeys"
    import Warning from "./Warning.svelte"

    let smoothing = true
    let averageDays = 7
    let draftAverageDays: number | undefined = averageDays
    let displayData: number[] = []
    let displaySeries: LineChartSeries[] = []
    let hasDisplayData = false
    let loadingSelectedSource = false

    const valueFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
    const formatValue = (value: number) => valueFormat.format(value)

    function applyAverageDays() {
        if (
            typeof draftAverageDays === "number" &&
            Number.isSafeInteger(draftAverageDays) &&
            draftAverageDays >= 1
        )
            averageDays = draftAverageDays
    }

    $: {
        const fsrsRaw = recallGainPerHundredReviews(
            $memorised_stats?.reviewRecallGainByDay ?? [],
            $memorised_stats?.reviewRecallGainCountsByDay ?? []
        )
        const rwkvRaw = recallGainPerHundredReviews(
            $rwkvReviewGainStats?.gainDays ?? [],
            $rwkvReviewGainStats?.countDays ?? []
        )
        const fsrsAverage = recallGainPerHundredReviews(
            $memorised_stats?.reviewRecallGainByDay ?? [],
            $memorised_stats?.reviewRecallGainCountsByDay ?? [],
            averageDays
        )
        const rwkvAverage = recallGainPerHundredReviews(
            $rwkvReviewGainStats?.gainDays ?? [],
            $rwkvReviewGainStats?.countDays ?? [],
            averageDays
        )
        const sources =
            $memorisedPerReviewMode === "both"
                ? [
                      {
                          label: i18n("memorised-source-fsrs"),
                          raw: fsrsRaw,
                          average: fsrsAverage,
                          color: FSRS_COMPARISON_COLOUR,
                      },
                      {
                          label: i18n("memorised-source-rwkv"),
                          raw: rwkvRaw,
                          average: rwkvAverage,
                          color: RWKV_COMPARISON_COLOUR,
                          dailyDash: "3 3",
                      },
                  ]
                : $memorisedPerReviewMode === "rwkv"
                  ? [
                        {
                            label: i18n("memorised-source-rwkv"),
                            raw: rwkvRaw,
                            average: rwkvAverage,
                            color: RWKV_COMPARISON_COLOUR,
                            dailyDash: "3 3",
                        },
                    ]
                  : [
                        {
                            label: i18n("memorised-source-fsrs"),
                            raw: fsrsRaw,
                            average: fsrsAverage,
                            color: FSRS_COMPARISON_COLOUR,
                        },
                    ]

        displaySeries = smoothing
            ? [
                  ...sources.map(({ label, average, color }) => ({
                      label: i18n("memorised-average-series", { label, days: averageDays }),
                      data: average,
                      color,
                      strokeWidth: 2.4,
                  })),
                  ...sources.map(({ label, raw, dailyDash }) => ({
                      label: i18n("memorised-daily-series", { label }),
                      data: raw,
                      color: "#888",
                      opacity: 0.35,
                      strokeWidth: 1.5,
                      strokeDasharray: dailyDash,
                      renderOrder: -1,
                      legend: false,
                      includeInYAxis: false,
                  })),
              ]
            : sources.map(({ label, raw, color }) => ({ label, data: raw, color }))
        displayData = displaySeries[0]?.data ?? []
        hasDisplayData = displaySeries.some((series) => series.data.some(Number.isFinite))
        loadingSelectedSource =
            $memorisedPerReviewMode !== "fsrs" &&
            (!$rwkvReviewGainStats || (!$rwkvReviewGainStats.done && !$rwkvReviewGainStats.error))
    }
    $: rwkvProgressPercent = $rwkvReviewGainStats?.total
        ? Math.min(100, Math.round((100 * $rwkvReviewGainStats.current) / $rwkvReviewGainStats.total))
        : 0
</script>

<MemorisedSourceControls bind:mode={$memorisedPerReviewMode} showHistoryProgress={false} />
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
        <button type="button" on:click={() => cancelRwkvReviewGainComputation()}>{i18n("cancel")}</button>
    </div>
{/if}
<div class="average-controls">
    <label>
        <input type="checkbox" bind:checked={smoothing} />
        {i18n("memorised-moving-average")}
    </label>
    <form on:submit|preventDefault={applyAverageDays}>
        <label>
            <input
                aria-label={i18n("memorised-average-days")}
                type="number"
                min="1"
                step="1"
                required
                disabled={!smoothing}
                bind:value={draftAverageDays}
                on:change={applyAverageDays}
            />
            {i18n("maturation-days")}
        </label>
    </form>
</div>
{#if hasDisplayData}
    <LineGraph
        data={displayData}
        series={displaySeries}
        label={i18n("memorised-per-review-axis")}
        formatY={formatValue}
        showIsolatedPoints
        includeNegative
        trendPersistenceKey={TREND_PERSISTENCE_KEYS.memorised.perReview}
    />
{:else}
    <p role="status">
        {i18n(loadingSelectedSource ? "loading" : "memorised-per-review-no-data")}
    </p>
{/if}
{#if smoothing}<p class="average-help">{i18n("memorised-per-review-average-help")}</p>{/if}

<style>
    .average-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5em 1em;
        margin-bottom: 0.6em;
        font-size: 0.85em;
    }

    .average-controls label {
        display: flex;
        align-items: center;
        gap: 0.4em;
    }

    .average-controls input[type="number"] {
        width: 4.5em;
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
