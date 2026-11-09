<script lang="ts">
    import AveragingControls from "./AveragingControls.svelte"
    import LineGraph from "./LineGraph.svelte"
    import type { LineChartSeries } from "./LineGraph"
    import {
        dailyMovingAverage,
        studyDayMovingAverage,
        type AveragingMode,
    } from "./dailyMovingAverage"
    import { i18n } from "./i18n"
    import TrendValue from "./TrendValue.svelte"
    import type { DrawnTrend, TrendInfo, TrendLine, TrendRange } from "./trend"

    export let data: number[]
    export let label: string
    export let color = "steelblue"
    export let trendPersistenceKey: string
    export let trendInfo: TrendInfo = {}
    export let dayRange: { start: number; end: number } | undefined = undefined
    export let tooltipDetails: ((day: number) => string[]) | undefined = undefined
    export let modes: Exclude<AveragingMode, "reviews">[] = ["calendar"]
    /** Legend and tooltip name of the primary series. */
    export let seriesLabel: string | undefined = undefined
    /** A second daily series drawn with the same averaging; trends stay on `data`. */
    export let comparison: { data: number[]; label: string; color: string } | undefined = undefined
    /** Show loading instead of no data while a source is still being computed. */
    export let loading = false

    let smoothing = true
    let days = 7
    let mode: AveragingMode = "calendar"
    let connectGaps = true
    let trends: DrawnTrend[] = []
    let trend: TrendLine = undefined
    let removeTrend: (id: number) => void = () => {}
    let togglePinTrend: (id: number) => void = () => {}
    let toggleTrendMode: (id: number) => void = () => {}
    let updateTrendRange: (id: number, range: TrendRange) => void = () => {}
    const valueFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
    const formatValue = (value: number) => valueFormat.format(value)

    const finiteDays = (values: number[]) =>
        Array.from(values, (value) => (Number.isFinite(value) ? value : Number.NaN))
    // Days from the first available value of any series through the end of the longest one.
    function availableRange(series: number[][]) {
        let start = Number.POSITIVE_INFINITY
        let end = -1
        for (const values of series) {
            const first = values.findIndex(Number.isFinite)
            if (first < 0) continue
            start = Math.min(start, first)
            end = Math.max(end, values.length - 1)
        }
        return end >= 0 ? { start, end } : undefined
    }
    const movingAverage = (values: number[], mode: AveragingMode, days: number) =>
        (mode === "study"
            ? studyDayMovingAverage(values, days)
            : dailyMovingAverage(values, days)
        ).map((value) => value ?? Number.NaN)

    type Source = { label: string; raw: number[]; average: number[]; color: string; dash?: string }
    function comparisonSource(
        { data, label, color }: NonNullable<typeof comparison>,
        mode: AveragingMode,
        days: number
    ): Source {
        const raw = finiteDays(data)
        return { label, raw, average: movingAverage(raw, mode, days), color, dash: "3 3" }
    }

    $: raw = finiteDays(data)
    $: average = movingAverage(raw, mode, days)
    $: sources = [
        { label: seriesLabel ?? label, raw, average, color },
        ...(comparison ? [comparisonSource(comparison, mode, days)] : []),
    ] satisfies Source[]
    $: chartRange = dayRange ?? availableRange(sources.map(({ raw }) => raw))
    $: windowLabel = i18n(
        mode === "study" ? "averaging-study-window" : "averaging-calendar-window",
        {
            count: days,
        }
    )
    function sourceSeries(
        { label, raw, average, color, dash }: Source,
        smoothing: boolean,
        windowLabel: string,
        connectGaps: boolean
    ): LineChartSeries[] {
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
                      strokeDasharray: dash,
                      renderOrder: -1,
                      legend: false,
                      includeInYAxis: false,
                  },
              ]
            : [{ label, data: raw, color }]
    }
    $: series = sources.flatMap((source) =>
        sourceSeries(source, smoothing, windowLabel, connectGaps)
    )
    $: hasData = sources.some(({ raw }) =>
        raw.some(
            (value, day) =>
                Number.isFinite(value) &&
                (!chartRange || (day >= chartRange.start && day <= chartRange.end))
        )
    )
</script>

<AveragingControls bind:enabled={smoothing} bind:mode bind:days bind:connectGaps {modes} />
{#if hasData}
    <LineGraph
        data={smoothing ? average : raw}
        {series}
        {label}
        dayRange={chartRange}
        {tooltipDetails}
        {trendPersistenceKey}
        legendWidth={180}
        formatY={formatValue}
        drawDefaultTrend
        showIsolatedPoints
        bind:trend_data={trends}
        bind:current_trend={trend}
        bind:removeTrend
        bind:togglePinTrend
        bind:toggleTrendMode
        bind:updateTrendRange
    />
    <TrendValue
        info={trendInfo}
        {trend}
        {trends}
        onRemoveTrend={removeTrend}
        onTogglePinTrend={togglePinTrend}
        onToggleTrendMode={toggleTrendMode}
        onUpdateTrendRange={updateTrendRange}
        dateAxis
    />
    {#if smoothing}
        <p class="average-help">{i18n("daily-line-average-help")}</p>
        {#if connectGaps}<p class="average-help">{i18n("averaging-gap-help")}</p>{/if}
    {/if}
{:else}
    <p role="status">{i18n(loading ? "loading" : "no-data")}</p>
{/if}

<style>
    .average-help {
        font-size: 0.85em;
    }
</style>
