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
        reviewGainHorizon,
        rwkvReviewGainStats,
    } from "./stores"
    import { TREND_PERSISTENCE_KEYS } from "./trendPersistenceKeys"
    import Warning from "./Warning.svelte"

    let smoothing = true
    let averageDays = 7
    let draftAverageDays: number | undefined = averageDays
    let view: "recall" | "gain" = "recall"
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
        const fsrs = $memorised_stats?.reviewRecallByHorizon[$reviewGainHorizon]
        const rwkv = $rwkvReviewGainStats
        const sources =
            $memorisedPerReviewMode === "both"
                ? [
                      {
                          label: i18n("memorised-source-fsrs"),
                          totals: fsrs,
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
                            color: RWKV_COMPARISON_COLOUR,
                            dailyDash: "3 3",
                        },
                    ]
                  : [
                        {
                            label: i18n("memorised-source-fsrs"),
                            totals: fsrs,
                            color: FSRS_COMPARISON_COLOUR,
                        },
                    ]

        displaySeries = sources.flatMap(({ label, totals, color, dailyDash }) => {
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
                    data: recallGainPerHundredReviews(
                        totals?.[key] ?? [],
                        count,
                        smoothing ? averageDays : 1
                    ),
                    color,
                    strokeWidth: 2.4,
                    strokeDasharray: dash,
                }))
            }
            const raw = recallGainPerHundredReviews(totals?.gain ?? [], count)
            const average = recallGainPerHundredReviews(totals?.gain ?? [], count, averageDays)
            return smoothing
                ? [
                      {
                          label: i18n("memorised-average-series", { label, days: averageDays }),
                          data: average,
                          color,
                          strokeWidth: 2.4,
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
        {i18n(loadingSelectedSource ? "loading" : "memorised-per-review-no-data")}
    </p>
{/if}
{#if smoothing}<p class="average-help">
        {i18n(
            view === "gain"
                ? "memorised-per-review-average-help"
                : "memorised-review-recall-average-help"
        )}
    </p>{/if}

<style>
    .average-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5em 1em;
        margin-bottom: 0.6em;
        font-size: 0.85em;
    }

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
