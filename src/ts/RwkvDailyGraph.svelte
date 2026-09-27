<script lang="ts">
    import { renderRwkvDailyGraph } from "./RwkvDailyGraph"
    import type { RwkvDailyMetric, RwkvDailyPoint } from "./rwkvDailyData"
    import { i18n } from "./i18n"
    import { onDestroy } from "svelte"
    import { tooltipShown } from "./stores"

    export let data: RwkvDailyPoint[]
    export let metric: RwkvDailyMetric
    let svg: SVGElement | undefined

    $: if (svg) renderRwkvDailyGraph(svg, data, metric)
    onDestroy(() => tooltipShown.set(false))
</script>

<svg bind:this={svg} aria-label={i18n(`rwkv-daily-${metric}`)}></svg>
