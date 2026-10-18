<script lang="ts">
    import GraphContainer from "./GraphContainer.svelte"
    import Calculator from "./Calculator.svelte"
    import LineGraph from "./LineGraph.svelte"
    import { buildMaturationSeries, smoothMaturationSeries } from "./maturation"
    import { NEW_COLOUR, YOUNG_COLOUR, MATURE_COLOUR, defaultGraphBounds } from "./graph"
    import { i18n } from "./i18n"
    import { TREND_PERSISTENCE_KEYS } from "./trendPersistenceKeys"
    import {
        maturationHistory,
        showMaturationStats,
        exposureStabilitySettings,
        searchLimit,
        maturationSmoothing,
    } from "./stores"

    export let mode: "counts" | "ratios" = "counts"
    let visible = {
        introduced: true,
        maturing: true,
        matured: true,
        maturingRatio: true,
        maturedRatio: true,
    }
    let chartWidth = 600
    let percentile = 90
    let draftPercentile: number | undefined = percentile
    function applyPercentile() {
        if (
            typeof draftPercentile === "number" &&
            Number.isInteger(draftPercentile) &&
            draftPercentile >= 1 &&
            draftPercentile <= 100
        )
            percentile = draftPercentile
    }
    $: averageDays = $maturationSmoothing.days
    function applyAverageDays() {
        if (Number.isSafeInteger(averageDays) && averageDays >= 1)
            maturationSmoothing.update((settings) => ({ ...settings, days: averageDays }))
    }
    function sizeCharts(node: HTMLDivElement) {
        let frame = 0
        const observer = new ResizeObserver(([entry]) => {
            const width = Math.floor(entry.contentRect.width)
            if (width === chartWidth) return
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
                chartWidth = width
            })
        })
        observer.observe(node)
        return {
            destroy() {
                observer.disconnect()
                cancelAnimationFrame(frame)
            },
        }
    }
    $: thresholds = $exposureStabilitySettings
    $: dailySeries = $maturationHistory
        ? buildMaturationSeries($maturationHistory, thresholds.s90Lower, thresholds.s90Upper)
        : null
    $: averaged =
        dailySeries && $maturationSmoothing.enabled
            ? smoothMaturationSeries(dailySeries, $maturationSmoothing.days)
            : null
    $: dayRange = dailySeries
        ? {
              start: Math.max(
                  dailySeries.firstDay,
                  $searchLimit ? dailySeries.lastDay - $searchLimit + 1 : dailySeries.firstDay
              ),
              end: dailySeries.lastDay,
          }
        : undefined
    $: marginLeft = mode === "ratios" ? 70 : 40
    $: bounds = {
        width: Math.max(160, chartWidth - marginLeft - 30),
        height: defaultGraphBounds().height,
        marginLeft,
    }
    $: maturingLabel = i18n("maturation-maturing", { value: thresholds.s90Lower })
    $: maturedLabel = i18n("maturation-matured", { value: thresholds.s90Upper })
    const percentFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
    const formatPercent = (value: number) => `${percentFormat.format(value)}%`
    const countFormat = (value: number) => percentFormat.format(value)
    let definitions: {
        key: "introduced" | "maturing" | "matured" | "maturingRatio" | "maturedRatio"
        label: string
        color: string
    }[]
    $: definitions =
        mode === "counts"
            ? [
                  { key: "introduced", label: i18n("introduced"), color: NEW_COLOUR },
                  { key: "maturing", label: maturingLabel, color: YOUNG_COLOUR },
                  { key: "matured", label: maturedLabel, color: MATURE_COLOUR },
              ]
            : [
                  { key: "maturingRatio", label: maturingLabel, color: YOUNG_COLOUR },
                  { key: "maturedRatio", label: maturedLabel, color: MATURE_COLOUR },
              ]
    $: displayedSeries = averaged ?? dailySeries
    $: chartSeries = displayedSeries
        ? definitions
              .filter(({ key }) => visible[key])
              .map(({ key, ...style }) => ({
                  ...style,
                  label: averaged
                      ? i18n("maturation-average-series", {
                            label: style.label,
                            days: $maturationSmoothing.days,
                        })
                      : style.label,
                  data: displayedSeries[key],
                  strokeWidth: averaged ? 2.2 : 1.5,
              }))
        : []
    $: chartLabel = i18n(mode === "counts" ? "maturation-counts-title" : "maturation-ratios-title")
</script>

<GraphContainer>
    <h1>{i18n(mode === "counts" ? "maturation-title" : "maturation-ratios-heading")}</h1>
    {#if dailySeries && $maturationHistory?.cards.length}
        <div class="chart-controls">
            <span>{chartLabel}</span>
            <form on:submit|preventDefault={applyPercentile}>
                <label>
                    {i18n("maturation-axis-cap")}
                    <span>
                        P
                        <input
                            aria-label={i18n("maturation-axis-cap")}
                            type="number"
                            min="1"
                            max="100"
                            step="1"
                            required
                            bind:value={draftPercentile}
                            on:change={applyPercentile}
                        />
                    </span>
                </label>
            </form>
        </div>
        <div class="curve-controls" role="group" aria-label={i18n("maturation-curves")}>
            {#each definitions as definition (definition.key)}
                <label>
                    <input type="checkbox" bind:checked={visible[definition.key]} />
                    <span class="curve-color" style:background-color={definition.color}></span>
                    {definition.label}
                </label>
            {/each}
        </div>
        <div class="average-controls">
            <label class="average-toggle">
                <input type="checkbox" bind:checked={$maturationSmoothing.enabled} />
                {i18n("maturation-moving-average")}
            </label>
            <form on:submit|preventDefault={applyAverageDays}>
                <label>
                    <input
                        aria-label={i18n("maturation-average-days")}
                        type="number"
                        min="1"
                        step="1"
                        required
                        disabled={!$maturationSmoothing.enabled}
                        bind:value={averageDays}
                        on:change={applyAverageDays}
                    />
                    {i18n("maturation-days")}
                </label>
            </form>
        </div>
        <div class="maturation-charts" use:sizeCharts>
            {#if chartSeries.length}
                <LineGraph
                    label={chartLabel}
                    data={chartSeries[0].data}
                    series={chartSeries}
                    {dayRange}
                    {bounds}
                    yPercentile={percentile}
                    formatY={mode === "ratios"
                        ? formatPercent
                        : $maturationSmoothing.enabled
                          ? countFormat
                          : undefined}
                    showIsolatedPoints
                    trendPersistenceKey={mode === "counts"
                        ? TREND_PERSISTENCE_KEYS.introduced.maturationCounts
                        : TREND_PERSISTENCE_KEYS.introduced.maturationRatios}
                />
            {:else}
                <p role="status">{i18n("maturation-select-curve")}</p>
            {/if}
        </div>
        <p>{i18n("maturation-cap-help")}</p>
        {#if $maturationSmoothing.enabled}<p>{i18n("maturation-average-help")}</p>{/if}
        <p>
            {i18n("maturation-coverage", {
                count: $maturationHistory.cards.length,
                excluded: $maturationHistory.incompleteCards,
            })}
        </p>
    {:else if dailySeries}
        <p>{i18n("maturation-empty")}</p>
    {:else}
        <Calculator shown={$showMaturationStats} calculate={() => showMaturationStats.set(true)} />
    {/if}
    <p>{i18n("maturation-help", { low: thresholds.s90Lower, high: thresholds.s90Upper })}</p>
</GraphContainer>

<style>
    .maturation-charts {
        width: 100%;
        min-width: 0;
    }
    .chart-controls {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.7em;
        margin-bottom: 0.5em;
        font-size: 0.85em;
    }
    label {
        display: flex;
        align-items: center;
        gap: 0.4em;
    }
    label span {
        display: inline-flex;
        align-items: center;
        gap: 0.2em;
    }
    input {
        width: 4.5em;
    }
    .average-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5em 1em;
        margin-bottom: 0.6em;
        font-size: 0.85em;
    }
    .average-toggle input,
    .curve-controls input {
        width: auto;
    }
    .curve-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5em 1em;
        margin-bottom: 0.6em;
        font-size: 0.85em;
    }
    .curve-color {
        width: 0.7em;
        height: 0.7em;
        border-radius: 2px;
    }
    .maturation-charts :global(svg) {
        display: block;
        width: 100%;
        height: auto;
        overflow: visible;
    }
    .maturation-charts :global(svg text) {
        font-size: 11px;
    }
</style>
