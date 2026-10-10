<script lang="ts">
    import Calculator from "./Calculator.svelte"
    import { requestFsrsStats, showMemorisedStats, showFsrsStats, showRevlogStats } from "./stores"

    export let includeMemorised = true
    export let calculate = () => requestFsrsStats(includeMemorised)
</script>

<Calculator
    {calculate}
    shown={(includeMemorised ? $showMemorisedStats : $showFsrsStats) && $showRevlogStats}
    badIfTruncated
></Calculator>
