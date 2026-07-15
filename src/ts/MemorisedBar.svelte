<script lang="ts">
    import * as _ from "lodash"
    import GraphContainer from "./GraphContainer.svelte"
    import type { LineChartSeries } from "./LineGraph"
    import LineOrCandlestick from "./LineOrCandlestick.svelte"
    import {
        binSize,
        cancelRwkvMemorisedComputation,
        memorisedMode,
        memorised_stats,
        rwkvMemorisedStats,
    } from "./stores"
    import { emptyTrendSelectionState, type TrendInfo, type TrendSelectionState } from "./trend"
    import TrendValue from "./TrendValue.svelte"
    import { matrix } from "./matrix"
    import { i18n, i18n_pattern } from "./i18n"
    import { TREND_PERSISTENCE_KEYS } from "./trendPersistenceKeys"
    import MemorisedCalculator from "./MemorisedCalculator.svelte"
    import Warning from "./Warning.svelte"

    export let burden: number[] = []

    let retrievabilityDays: number[] | undefined = undefined
    let stable_retrievability_days: number[] | undefined = undefined
    let bw_matrix: Record<string, (number | undefined)[]> | undefined = undefined
    let cardsByBurdenByDays: number[] = []
    let rwkvCardsByBurdenByDays: number[] = []

    enum MemorisedType {
        RETRIEVABILITY,
        NOTES,
        STABLE_RETRIEVABILITY,
        AVERAGE,
        CARDS_BY_BURDEN,
    }

    let memorised_type: MemorisedType = MemorisedType.RETRIEVABILITY

    $: retrievabilityDays = Array.from($memorised_stats?.retrievabilityDays || [])
    $: stable_retrievability_days = Array.from($memorised_stats?.stable_retrievability_days || [])

    $: cardsByBurdenByDays = retrievabilityDays.map(
        (retrievability, i) => (retrievability ?? 0) / (burden[i] ?? 1)
    )
    $: rwkvCardsByBurdenByDays = ($rwkvMemorisedStats?.retrievabilityDays ?? []).map(
        (retrievability, i) => (retrievability ?? 0) / (burden[i] ?? 1)
    )

    $: bw_matrix = Object.fromEntries(
        Object.entries($memorised_stats?.bw_matrix || {}).map(([r_bin, row]) => {
            const new_row = row.map((bin) =>
                bin.count > 50 ? (bin.real - bin.predicted) / bin.count : undefined
            )
            new_row.length = 10
            return [r_bin, new_row]
        })
    )

    let trend_info: TrendInfo
    $: trend_info = {
        pattern: i18n_pattern("remembered-per-day"),
        positivePattern: i18n_pattern("remembered-per-day"),
        negativePattern: i18n_pattern("forgotten-per-day"),
        absolute: true,
    }

    let trendSelection: TrendSelectionState = emptyTrendSelectionState()
    let svg: SVGElement | undefined = undefined

    function hoverTooltip(x: number, y: number) {
        const data = $memorised_stats!.bw_matrix[x][y]
        const value = ((100 * (data.predicted - data.real)) / data.count).toFixed(1)
        return [
            `${i18n("predicted")}: ${data.predicted.toFixed(2)}`,
            `${i18n("actual")}: ${data.real.toFixed(0)}`,
            `${i18n("total")}: ${data.count.toFixed(0)}`,
            `(${data.predicted.toFixed(2)}-${data.real.toFixed(0)})/${data.count.toFixed(0)}=${value}%`,
        ]
    }

    $: if (svg && bw_matrix) {
        matrix({ grid: bw_matrix, hoverTooltip }, svg)
    }

    let average_r = <number[]>[]
    let rwkv_average_r = <number[]>[]
    $: if ($memorised_stats?.totalCards) {
        average_r = _.zip(retrievabilityDays, $memorised_stats.totalCards).map(([r, c]) => {
            // console.log({ r, c })
            return (r ?? 0) / (c ?? 1)
        })
    }
    $: rwkv_average_r = _.zip(
        $rwkvMemorisedStats?.retrievabilityDays ?? [],
        $rwkvMemorisedStats?.totalCards ?? []
    ).map(([r, c]) => (r ?? 0) / (c ?? 1))

    let displayData: number[] = []
    let displaySeries: LineChartSeries[] | undefined = undefined
    let displayLabel = ""
    let displayTrendKey: string = TREND_PERSISTENCE_KEYS.memorised.cards
    let supportsRwkv = true

    $: {
        let fsrsData: number[]
        let rwkvData: number[]
        supportsRwkv = true
        if (memorised_type === MemorisedType.NOTES) {
            fsrsData = Array.from($memorised_stats?.noteRetrievabilityDays ?? [])
            rwkvData = Array.from($rwkvMemorisedStats?.noteRetrievabilityDays ?? [])
            displayLabel = i18n("notes")
            displayTrendKey = TREND_PERSISTENCE_KEYS.memorised.notes
        } else if (memorised_type === MemorisedType.CARDS_BY_BURDEN) {
            fsrsData = cardsByBurdenByDays
            rwkvData = rwkvCardsByBurdenByDays
            displayLabel = i18n("cards-by-burden")
            displayTrendKey = TREND_PERSISTENCE_KEYS.memorised.cardsByBurden
        } else if (memorised_type === MemorisedType.AVERAGE) {
            fsrsData = average_r
            rwkvData = rwkv_average_r
            displayLabel = i18n("retrievability")
            displayTrendKey = TREND_PERSISTENCE_KEYS.memorised.retrievability
        } else if (memorised_type === MemorisedType.STABLE_RETRIEVABILITY) {
            fsrsData = stable_retrievability_days
            rwkvData = []
            supportsRwkv = false
            displayLabel = i18n("cards-and-stability")
            displayTrendKey = TREND_PERSISTENCE_KEYS.memorised.stableRetrievability
        } else {
            fsrsData = retrievabilityDays
            rwkvData = Array.from($rwkvMemorisedStats?.retrievabilityDays ?? [])
            displayLabel = i18n("cards")
            displayTrendKey = TREND_PERSISTENCE_KEYS.memorised.cards
        }

        displayData = supportsRwkv && $memorisedMode === "rwkv" ? rwkvData : fsrsData
        displaySeries =
            supportsRwkv && $memorisedMode === "both"
                ? [
                      { label: i18n("memorised-source-fsrs"), data: fsrsData, color: "steelblue" },
                      { label: i18n("memorised-source-rwkv"), data: rwkvData, color: "seagreen" },
                  ]
                : supportsRwkv && $memorisedMode === "rwkv"
                  ? [
                        {
                            label: i18n("memorised-source-rwkv"),
                            data: rwkvData,
                            color: "seagreen",
                        },
                    ]
                  : undefined
    }

    $: rwkvProgressPercent =
        $rwkvMemorisedStats?.total && $rwkvMemorisedStats.total > 0
            ? Math.min(
                  100,
                  Math.round((100 * $rwkvMemorisedStats.current) / $rwkvMemorisedStats.total)
              )
            : 0
</script>

{#if $memorised_stats}
    <div class="memorised-source" role="group" aria-label={i18n("memorised-source")}>
        <label>
            <input type="radio" value="fsrs" bind:group={$memorisedMode} />
            {i18n("memorised-source-fsrs")}
        </label>
        <label>
            <input type="radio" value="rwkv" bind:group={$memorisedMode} />
            {i18n("memorised-source-rwkv")}
        </label>
        <label>
            <input type="radio" value="both" bind:group={$memorisedMode} />
            {i18n("memorised-source-both")}
        </label>
    </div>
    {#if !supportsRwkv && $memorisedMode !== "fsrs"}
        <Warning always>{i18n("memorised-rwkv-stability-unavailable")}</Warning>
    {/if}
    {#if $memorisedMode !== "fsrs" && $rwkvMemorisedStats?.error}
        <Warning always>{$rwkvMemorisedStats.error}</Warning>
    {:else if $memorisedMode !== "fsrs" && $rwkvMemorisedStats && !$rwkvMemorisedStats.done}
        <div class="rwkv-progress">
            <div>
                {$rwkvMemorisedStats.phase === "checkpointing"
                    ? i18n("memorised-rwkv-saving-checkpoint")
                    : i18n("memorised-rwkv-progress", {
                          current: $rwkvMemorisedStats.current,
                          total: $rwkvMemorisedStats.total,
                          percent: rwkvProgressPercent,
                      })}
            </div>
            <progress
                max={$rwkvMemorisedStats.total || 1}
                value={$rwkvMemorisedStats.current}
                aria-label={i18n("memorised-rwkv-progress-label")}
            ></progress>
            <button
                type="button"
                disabled={$rwkvMemorisedStats.phase === "checkpointing"}
                on:click={() => cancelRwkvMemorisedComputation()}
            >
                {i18n("cancel")}
            </button>
        </div>
    {/if}
    <LineOrCandlestick
        data={displayData}
        series={displaySeries}
        label={displayLabel}
        bind:trendSelection
        trendPersistenceKey={displayTrendKey}
    />
    <TrendValue
        info={trend_info}
        trend={trendSelection.previewTrend}
        trends={trendSelection.visibleTrends}
        n={$binSize}
        onRemoveTrend={trendSelection.removeTrend}
        onTogglePinTrend={trendSelection.togglePinTrend}
        onToggleTrendMode={trendSelection.toggleTrendMode}
        onUpdateTrendRange={trendSelection.updateTrendRange}
        dateAxis
    />
    <div>
        <label>
            <input type="radio" value={MemorisedType.RETRIEVABILITY} bind:group={memorised_type} />
            {i18n("cards")}
        </label>
        <label>
            <input type="radio" value={MemorisedType.NOTES} bind:group={memorised_type} />
            {i18n("notes")}
        </label>
        <label>
            <input type="radio" value={MemorisedType.CARDS_BY_BURDEN} bind:group={memorised_type} />
            {i18n("cards-by-burden")}
        </label>
        <label>
            <input type="radio" value={MemorisedType.AVERAGE} bind:group={memorised_type} />
            {i18n("average-retrievability")}
        </label>
        <label>
            <input
                type="radio"
                value={MemorisedType.STABLE_RETRIEVABILITY}
                bind:group={memorised_type}
            />
            {i18n("retrievability-and-stability")}
        </label>
    </div>
{:else}
    <MemorisedCalculator />
{/if}
{#if bw_matrix}
    <details>
        <summary>{i18n("b-w-matrix")}</summary>
        <GraphContainer>
            <svg bind:this={svg}></svg>
        </GraphContainer>
    </details>
{/if}

<style>
    .memorised-source {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
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
