<script lang="ts">
    import GraphContainer from "./GraphContainer.svelte"
    import RevlogCalculator from "./RevlogCalculator.svelte"
    import { revlogStats } from "./stores"
    export let graphId = ""
</script>

<GraphContainer {graphId}>
    <slot name="title"></slot>
    {#if $revlogStats}
        <slot name="graph"></slot>
    {:else}
        <RevlogCalculator></RevlogCalculator>
    {/if}
    <slot></slot>
</GraphContainer>
