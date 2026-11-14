<script lang="ts">
    import * as _ from "lodash"
    import GraphContainer from "./GraphContainer.svelte"
    import type { LineChartSeries } from "./LineGraph"
    import LineOrCandlestick from "./LineOrCandlestick.svelte"
    import { binSize, memorisedMode, memorised_stats, rwkvMemorisedStats } from "./stores"
    import { emptyTrendSelectionState, type TrendInfo, type TrendSelectionState } from "./trend"
    import TrendValue from "./TrendValue.svelte"
    import { matrix } from "./matrix"
    import { i18n, i18n_pattern } from "./i18n"
    import { TREND_PERSISTENCE_KEYS } from "./trendPersistenceKeys"
    import MemorisedCalculator from "./MemorisedCalculator.svelte"
    import { plottableDailyMovingAverage } from "./dailyMovingAverage"
    import MemorisedSourceControls from "./MemorisedSourceControls.svelte"

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
    let smoothing = true
    let averageDays = 7
    let draftAverageDays: number | undefined = averageDays

    function applyAverageDays() {
        if (
            typeof draftAverageDays === "number" &&
            Number.isSafeInteger(draftAverageDays) &&
            draftAverageDays >= 1
        )
            averageDays = draftAverageDays
    }

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
        let rawFsrsData: number[]
        let rawRwkvData: number[]
        supportsRwkv = true
        if (memorised_type === MemorisedType.NOTES) {
            rawFsrsData = Array.from($memorised_stats?.noteRetrievabilityDays ?? [])
            rawRwkvData = Array.from($rwkvMemorisedStats?.noteRetrievabilityDays ?? [])
            displayLabel = i18n("notes")
            displayTrendKey = TREND_PERSISTENCE_KEYS.memorised.notes
        } else if (memorised_type === MemorisedType.CARDS_BY_BURDEN) {
            rawFsrsData = cardsByBurdenByDays
            rawRwkvData = rwkvCardsByBurdenByDays
            displayLabel = i18n("cards-by-burden")
            displayTrendKey = TREND_PERSISTENCE_KEYS.memorised.cardsByBurden
        } else if (memorised_type === MemorisedType.AVERAGE) {
            rawFsrsData = average_r
            rawRwkvData = rwkv_average_r
            displayLabel = i18n("retrievability")
            displayTrendKey = TREND_PERSISTENCE_KEYS.memorised.retrievability
        } else if (memorised_type === MemorisedType.STABLE_RETRIEVABILITY) {
            rawFsrsData = stable_retrievability_days
            rawRwkvData = []
            supportsRwkv = false
            displayLabel = i18n("cards-and-stability")
            displayTrendKey = TREND_PERSISTENCE_KEYS.memorised.stableRetrievability
        } else {
            rawFsrsData = retrievabilityDays
            rawRwkvData = Array.from($rwkvMemorisedStats?.retrievabilityDays ?? [])
            displayLabel = i18n("cards")
            displayTrendKey = TREND_PERSISTENCE_KEYS.memorised.cards
        }

        const fsrsData = smoothing
            ? plottableDailyMovingAverage(rawFsrsData, averageDays)
            : rawFsrsData
        const rwkvData = smoothing
            ? plottableDailyMovingAverage(rawRwkvData, averageDays)
            : rawRwkvData
        const averageSeries = (label: string, data: number[], color: string) => ({
            label: i18n("memorised-average-series", { label, days: averageDays }),
            data,
            color,
            strokeWidth: 2.4,
        })
        const dailySeries = (
            label: string,
            data: number[],
            strokeDasharray?: string
        ): LineChartSeries => ({
            label: i18n("memorised-daily-series", { label }),
            data,
            color: "#888",
            opacity: 0.35,
            strokeWidth: 1.5,
            strokeDasharray,
            renderOrder: -1,
            legend: false,
        })
        const fsrsLabel =
            $memorisedMode === "fsrs" || !supportsRwkv
                ? displayLabel
                : i18n("memorised-source-fsrs")
        const rwkvLabel = i18n("memorised-source-rwkv")

        displayData = supportsRwkv && $memorisedMode === "rwkv" ? rwkvData : fsrsData
        displaySeries =
            supportsRwkv && $memorisedMode === "both"
                ? smoothing
                    ? [
                          averageSeries(fsrsLabel, fsrsData, "steelblue"),
                          averageSeries(rwkvLabel, rwkvData, "seagreen"),
                          dailySeries(fsrsLabel, rawFsrsData),
                          dailySeries(rwkvLabel, rawRwkvData, "3 3"),
                      ]
                    : [
                          { label: fsrsLabel, data: fsrsData, color: "steelblue" },
                          { label: rwkvLabel, data: rwkvData, color: "seagreen" },
                      ]
                : supportsRwkv && $memorisedMode === "rwkv"
                  ? smoothing
                      ? [
                            averageSeries(rwkvLabel, rwkvData, "seagreen"),
                            dailySeries(rwkvLabel, rawRwkvData, "3 3"),
                        ]
                      : [{ label: rwkvLabel, data: rwkvData, color: "seagreen" }]
                  : smoothing
                    ? [
                          averageSeries(fsrsLabel, fsrsData, "steelblue"),
                          dailySeries(fsrsLabel, rawFsrsData),
                      ]
                    : undefined
    }
</script>

{#if $memorised_stats}
    <MemorisedSourceControls bind:mode={$memorisedMode} {supportsRwkv} />
    <div class="memorised-average-controls">
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
    <LineOrCandlestick
        data={displayData}
        series={displaySeries}
        label={displayLabel}
        bind:trendSelection
        trendPersistenceKey={displayTrendKey}
        preserveTrendsOnKeyChange
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
    {#if smoothing}<p class="average-help">{i18n("memorised-average-help")}</p>{/if}
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
    .memorised-average-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5em 1em;
        margin-bottom: 0.6em;
        font-size: 0.85em;
    }

    .memorised-average-controls label {
        display: flex;
        align-items: center;
        gap: 0.4em;
    }

    .memorised-average-controls input[type="number"] {
        width: 4.5em;
    }

    .average-help {
        font-size: 0.85em;
    }
</style>
