<script lang="ts">
    import { renderRocGraph } from "./ROCGraph"
    import { i18n } from "./i18n"
    import type { RocData } from "./rocData"

    let svg: SVGElement | undefined

    export let data: RocData

    const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(4)}`

    $: if (svg) renderRocGraph(svg, data)
</script>

<svg bind:this={svg}></svg>

{#if data.difference}
    <p class="roc-difference">
        {i18n("roc-auc-difference", {
            difference: signed(data.difference.value),
            lower: signed(data.difference.interval.lower),
            upper: signed(data.difference.interval.upper),
        })}
    </p>
{/if}
