<script lang="ts">
    import GraphContainer from "./GraphContainer.svelte"
    import MemorisedCalculator from "./MemorisedCalculator.svelte"
    import { showFsrsStats, showRevlogStats } from "./stores"
</script>

<!-- Calibration graphs only need FSRS stats enabled, not the finished Memorised replay. -->
<GraphContainer>
    <slot name="title"></slot>
    {#if $showFsrsStats && $showRevlogStats}
        <slot name="graph"></slot>
    {:else}
        <MemorisedCalculator></MemorisedCalculator>
    {/if}
    <slot></slot>
</GraphContainer>
