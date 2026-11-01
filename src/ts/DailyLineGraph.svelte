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

    $: raw = Array.from(data, (value) => (Number.isFinite(value) ? value : Number.NaN))
    $: firstDay = raw.findIndex(Number.isFinite)
    $: chartRange =
        dayRange ?? (firstDay >= 0 ? { start: firstDay, end: raw.length - 1 } : undefined)
    $: average = (
        mode === "study" ? studyDayMovingAverage(raw, days) : dailyMovingAverage(raw, days)
    ).map((value) => value ?? Number.NaN)
    $: windowLabel = i18n(
        mode === "study" ? "averaging-study-window" : "averaging-calendar-window",
        {
            count: days,
        }
    )
    $: series = smoothing
        ? ([
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
                  renderOrder: -1,
                  legend: false,
                  includeInYAxis: false,
              },
          ] satisfies LineChartSeries[])
        : [{ label, data: raw, color }]
    $: hasData = raw.some(
        (value, day) =>
            Number.isFinite(value) &&
            (!chartRange || (day >= chartRange.start && day <= chartRange.end))
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
    <p role="status">{i18n("no-data")}</p>
{/if}

<style>
    .average-help {
        font-size: 0.85em;
    }
</style>
