<script lang="ts">
    import GraphContainer from "./GraphContainer.svelte"
    import Calculator from "./Calculator.svelte"
    import LineGraph from "./LineGraph.svelte"
    import { buildMaturationSeries } from "./maturation"
    import { NEW_COLOUR, YOUNG_COLOUR, MATURE_COLOUR } from "./graph"
    import { i18n } from "./i18n"
    import { TREND_PERSISTENCE_KEYS } from "./trendPersistenceKeys"
    import {
        maturationHistory,
        showMaturationStats,
        exposureStabilitySettings,
        searchLimit,
    } from "./stores"

    let chartWidth = 600
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
    $: series = $maturationHistory
        ? buildMaturationSeries($maturationHistory, thresholds.s90Lower, thresholds.s90Upper)
        : null
    $: dayRange = series
        ? {
              start: Math.max(
                  series.firstDay,
                  $searchLimit ? series.lastDay - $searchLimit + 1 : series.firstDay
              ),
              end: series.lastDay,
          }
        : undefined
    $: bounds = { width: Math.max(160, chartWidth - 70), height: 170 }
    $: maturingLabel = i18n("maturation-maturing", { value: thresholds.s90Lower })
    $: maturedLabel = i18n("maturation-matured", { value: thresholds.s90Upper })
    const percentFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
    const formatPercent = (value: number) => `${percentFormat.format(value)}%`
</script>

<GraphContainer>
    <h1>{i18n("maturation-title")}</h1>
    {#if series && $maturationHistory?.cards.length}
        <div class="maturation-charts" use:sizeCharts>
            <h3>{i18n("maturation-counts-title")}</h3>
            <LineGraph
                label={i18n("maturation-counts-title")}
                data={series.introduced}
                series={[
                    { label: i18n("introduced"), data: series.introduced, color: NEW_COLOUR },
                    { label: maturingLabel, data: series.maturing, color: YOUNG_COLOUR },
                    { label: maturedLabel, data: series.matured, color: MATURE_COLOUR },
                ]}
                {dayRange}
                {bounds}
                showIsolatedPoints
                trendPersistenceKey={TREND_PERSISTENCE_KEYS.introduced.maturationCounts}
            />
            <h3>{i18n("maturation-ratios-title")}</h3>
            <LineGraph
                label={i18n("maturation-ratios-title")}
                data={series.maturingRatio}
                series={[
                    { label: maturingLabel, data: series.maturingRatio, color: YOUNG_COLOUR },
                    { label: maturedLabel, data: series.maturedRatio, color: MATURE_COLOUR },
                ]}
                {dayRange}
                {bounds}
                formatY={formatPercent}
                showIsolatedPoints
                trendPersistenceKey={TREND_PERSISTENCE_KEYS.introduced.maturationRatios}
            />
        </div>
        <p>
            {i18n("maturation-coverage", {
                count: $maturationHistory.cards.length,
                excluded: $maturationHistory.incompleteCards,
            })}
        </p>
    {:else if series}
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
    h3 {
        font-size: 0.9em;
        font-weight: 500;
        margin: 0.7em 0 0;
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
