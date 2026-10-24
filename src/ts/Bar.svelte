<script lang="ts">
    import _ from "lodash"
    import {
        barDateLabeler,
        barHourLabeler,
        renderBarChart,
        type BarChart,
        type ExtraRenderInput,
    } from "./bar"
    import NoGraph from "./NoGraph.svelte"
    import {
        boundedZoom,
        dragZoom,
        selectedZoomRange,
        type ZoomRange,
        type DragZoomOptions,
    } from "./dragZoom"
    import ZoomControls from "./ZoomControls.svelte"
    import { defaultGraphBounds } from "./graph"

    let svg: SVGElement | null = null
    export let extraRender = (chart: ExtraRenderInput<BarChart>) => {}

    export let data: BarChart
    export let zoomable: boolean | undefined = undefined
    export let onZoom: ((range: ZoomRange) => void) | undefined = undefined
    export let zoomed = false
    export let resetZoom: () => void = () => {
        localZoom = undefined
    }
    let localZoom: ZoomRange | undefined
    let zoomOptions: DragZoomOptions | undefined
    $: canZoom =
        zoomable ?? (data.columnLabeler === barDateLabeler || data.columnLabeler === barHourLabeler)
    $: visibleRange = boundedZoom(localZoom, { start: 0, end: data.data.length - 1 })
    function selectRange(start: number, end: number) {
        const range = selectedZoomRange(visibleRange, start, end, true)
        if (onZoom) onZoom(range)
        else localZoom = range
    }
    $: {
        if (svg && data.data.length) {
            const chart = renderBarChart(
                { ...data, data: data.data.slice(visibleRange.start, visibleRange.end + 1) },
                svg as any
            )
            extraRender(chart)
            zoomOptions =
                canZoom && chart.chart.data.length > 1
                    ? {
                          ...defaultGraphBounds(),
                          onSelect: selectRange,
                      }
                    : undefined
        }
    }

    let glossary: [string | undefined, string | undefined][]

    $: {
        glossary = _.zip(data.row_labels, data.row_colours)
        if (data.reverse_legend) glossary = glossary.reverse()
    }
</script>

{#if !data.data.length}
    <NoGraph></NoGraph>
{:else}
    <div class="glossary">
        {#each glossary as [label, colour]}
            <div>
                <span style={`color:${colour}`}>■&nbsp;</span>
                {label}
            </div>
        {/each}
    </div>
    {#if canZoom}<ZoomControls zoomed={zoomed || !!localZoom} reset={resetZoom} />{/if}
    <svg bind:this={svg} use:dragZoom={zoomOptions}>
        <pattern
            id="stripe"
            patternUnits="userSpaceOnUse"
            width="10"
            height="10"
            patternTransform="rotate(45)"
        >
            <line x1="0" y="0" x2="0" y2="10" stroke="#921717" stroke-width="10" />
        </pattern>
    </svg>
{/if}

<style>
    div.glossary {
        display: flex;
        gap: 1em;
    }
</style>
