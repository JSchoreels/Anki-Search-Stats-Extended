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

{#if data.disagreementPercentiles.length > 0}
    <p class="um-plus-disagreement-summary">
        <span>{i18n("um-plus-disagreement-summary")}</span>
        {#each data.disagreementPercentiles as { percentile, absoluteDisagreement }}
            <span class="um-plus-disagreement-percentile">
                {i18n("um-plus-disagreement-percentile", {
                    percentile,
                    value: (Math.ceil(absoluteDisagreement * 1000 - 1e-10) / 10).toFixed(1),
                })}
            </span>
        {/each}
    </p>
{/if}

<style>
    .small-bucket-toggle {
        align-self: flex-start;
    }

    .um-plus-disagreement-summary {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4em 1em;
        margin: 0;
    }

    .um-plus-disagreement-percentile {
        white-space: nowrap;
    }
</style>
