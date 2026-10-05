<script lang="ts">
    import { fsrsCalibrationGeneration } from "./stores"
    $: busy =
        $fsrsCalibrationGeneration?.phase === "queued" ||
        $fsrsCalibrationGeneration?.phase === "running"
</script>

{#if busy}
    <p role="status">
        {$fsrsCalibrationGeneration?.label ?? "Preparing FSRS calibration data"}
        {#if $fsrsCalibrationGeneration?.totalPresets}
            ({$fsrsCalibrationGeneration.currentPreset}/{$fsrsCalibrationGeneration.totalPresets})
        {/if}
    </p>
{/if}
{#if $fsrsCalibrationGeneration?.warnings?.length}
    <p role="alert">{$fsrsCalibrationGeneration.warnings.join(" ")}</p>
{/if}
