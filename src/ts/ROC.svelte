<script lang="ts">
    import { renderRocGraph } from "./ROCGraph"
    import type { RocData } from "./rocData"

    let svg: SVGElement | undefined

    export let data: RocData

    $: if (svg) renderRocGraph(svg, data)
</script>

<svg bind:this={svg}></svg>
