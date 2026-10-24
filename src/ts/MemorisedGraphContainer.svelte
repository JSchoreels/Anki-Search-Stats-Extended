<script lang="ts">
    import GraphContainer from "./GraphContainer.svelte"
    import MemorisedCalculator from "./MemorisedCalculator.svelte"
    import { memorised_stats } from "./stores"
    export let graphId = ""
</script>

<GraphContainer {graphId}>
    <slot name="title"></slot>
    {#if $memorised_stats}
        <slot name="graph"></slot>
    {:else}
        <MemorisedCalculator></MemorisedCalculator>
    {/if}
    <slot></slot>
</GraphContainer>
