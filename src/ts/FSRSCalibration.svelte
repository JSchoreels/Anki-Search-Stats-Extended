<script lang="ts">
    import { fsrsCalibrationGraph, type CalibrationSeries } from "./FSRScalibration"
    import type { LossBin } from "./MemorisedBar"

    let svg: SVGElement | undefined

    export let data: LossBin[]
    export let series: CalibrationSeries[] | undefined = undefined

    $: if (svg) fsrsCalibrationGraph(svg, series ?? data)
</script>

<svg bind:this={svg}></svg>
