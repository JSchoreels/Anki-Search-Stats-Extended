<script lang="ts">
    import { renderLineChart, type LineChartSeries } from "./LineGraph"
    import {
        type DrawnTrend,
        type InitialTrend,
        type TrendLine,
        type TrendRange,
        type TrendSelectionController,
    } from "./trend"
    import { dragZoom, type DragZoomOptions, type ZoomRange } from "./dragZoom"
    import ZoomControls from "./ZoomControls.svelte"
    import {
        hiddenPinnedRanges,
        mergeTrendRanges,
        mergeVisibleCustomTrends,
        removeTrendFromAll,
    } from "./trendSession"
    import {
        loadPinnedTrendRanges,
        queuePersistPinnedRanges,
        queuePersistStoredPinnedRanges,
    } from "./trendPinnedPersistence"

    let svg: SVGElement | undefined
    let zoomRange: ZoomRange | undefined
    let zoomOptions: DragZoomOptions | undefined
    let allTrends: InitialTrend[] = []
    const retainedTrends = () => allTrends
    let lastKey: string

    export let label: string
    export let data: number[]
    export let series: LineChartSeries[] | undefined = undefined
    export let dayRange: { start: number; end: number } | undefined = undefined
    export let bounds: { width: number; height: number; marginLeft?: number } | undefined =
        undefined
    export let formatY: ((value: number) => string) | undefined = undefined
    export let showIsolatedPoints = false
    export let yPercentile: number | undefined = undefined
    export let includeNegative = false
    export let trend_data: DrawnTrend[] = []
    export let current_trend: TrendLine = undefined
    export let removeTrend: (id: number) => void = () => {}
    export let togglePinTrend: (id: number) => void = () => {}
    export let toggleTrendMode: (id: number) => void = () => {}
    export let updateTrendRange: (
        id: number,
        range: import("./trend").TrendRange
    ) => void = () => {}
    export let trendPersistenceKey: string
    let migrated_temporal_store_keys = new Set<string>()

    // Trend edits update the retained session without redrawing the SVG under a dragged handle.
    function acceptTrends(nextTrends: DrawnTrend[]) {
        trend_data = nextTrends
        allTrends = mergeVisibleCustomTrends(allTrends, nextTrends)
    }

    function controllerReady(controller: TrendSelectionController) {
        removeTrend = (id) => {
            allTrends = removeTrendFromAll(
                allTrends,
                trend_data.find((trend) => trend.id === id)
            )
            controller.removeTrend(id)
        }
        togglePinTrend = controller.togglePin
        toggleTrendMode = controller.toggleMode
        updateTrendRange = controller.updateRange
    }

    function persistRanges(ranges: TrendRange[]) {
        void queuePersistPinnedRanges(
            trendPersistenceKey,
            mergeTrendRanges(hiddenPinnedRanges(allTrends, trend_data), ranges),
            true
        )
    }

    $: if (trendPersistenceKey !== lastKey) {
        lastKey = trendPersistenceKey
        zoomRange = undefined
        allTrends = []
    }

    $: if (svg) {
        const { initialPinnedRanges, migratedStoredRanges } = loadPinnedTrendRanges(
            trendPersistenceKey,
            true
        )
        if (migratedStoredRanges && !migrated_temporal_store_keys.has(trendPersistenceKey)) {
            migrated_temporal_store_keys.add(trendPersistenceKey)
            void queuePersistStoredPinnedRanges(trendPersistenceKey, migratedStoredRanges)
        }

        zoomOptions = renderLineChart(svg, data, label, {
            onTrendsChange: acceptTrends,
            onPreviewTrendChange: (nextTrend) => {
                current_trend = nextTrend
            },
            onControllerReady: controllerReady,
            initialPinnedTrends: initialPinnedRanges,
            initialTrends: retainedTrends(),
            onPinnedRangesChange: persistRanges,
            series,
            dayRange,
            zoomRange,
            onZoom: (range) => {
                zoomRange = range
            },
            bounds,
            formatY,
            showIsolatedPoints,
            yPercentile,
            includeNegative,
        })
    }
</script>

<ZoomControls
    zoomed={!!zoomRange}
    reset={() => {
        zoomRange = undefined
    }}
/>
<svg bind:this={svg} use:dragZoom={zoomOptions} role="img" aria-label={label}></svg>
