<script lang="ts">
    import { renderUmPlusGraph } from "./UMPlusGraph"
    import { i18n } from "./i18n"
    import type { UmPlusData } from "./umPlusData"

    let svg: SVGElement | undefined
    let showSmallBuckets = false

    export let data: UmPlusData

    $: if (svg) renderUmPlusGraph(svg, data, { showSmallBuckets })
</script>

<label class="small-bucket-toggle">
    <input type="checkbox" bind:checked={showSmallBuckets} />
    {i18n("um-plus-show-small-buckets")}
</label>
<svg bind:this={svg}></svg>

<style>
    .small-bucket-toggle {
        align-self: flex-start;
    }
</style>
