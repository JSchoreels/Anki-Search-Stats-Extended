<script lang="ts">
    import { cids, fsrsCalibrationGeneration, generateFsrsCalibration } from "./stores"
    $: busy =
        $fsrsCalibrationGeneration?.phase === "queued" ||
        $fsrsCalibrationGeneration?.phase === "running"
</script>

<div class="generation">
    <button disabled={busy || !$cids?.length} on:click={() => generateFsrsCalibration()}>
        Generate FSRS calibration data
    </button>
    {#if busy}
        <div role="status">
            {$fsrsCalibrationGeneration?.label ?? "Preparing historical FSRS calibration"}
            {#if $fsrsCalibrationGeneration?.totalPresets}
                ({$fsrsCalibrationGeneration.currentPreset}/{$fsrsCalibrationGeneration.totalPresets})
            {/if}
        </div>
    {:else if $fsrsCalibrationGeneration?.phase === "ready" && !$fsrsCalibrationGeneration.warnings.length}
        <div role="status">Historical FSRS calibration data is ready.</div>
    {/if}
    {#if $fsrsCalibrationGeneration?.warnings.length}
        <div role="alert">{$fsrsCalibrationGeneration.warnings.join(" ")}</div>
    {/if}
</div>

<style>
    .generation {
        margin-top: 12px;
    }
    button {
        margin-bottom: 6px;
    }
</style>
