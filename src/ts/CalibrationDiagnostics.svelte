<script lang="ts">
    export let report: string
    export let useHistoricalReplay = false
</script>

<details class="calibration-diagnostics" open>
    <summary>Calibration diagnostics (test build)</summary>
    <label>
        <input type="checkbox" bind:checked={useHistoricalReplay} />
        Use full-history FSRS replay (diagnostic)
    </label>
    {#if useHistoricalReplay}
        <p role="status">
            Calibration, UM+ and ROC now use current FSRS parameters replayed over eligible past
            reviews. This is not held-out validation. Cached predictions remain unchanged.
        </p>
    {/if}
    <p>Click the report to select it, copy it, and send it back with your screenshot.</p>
    <textarea
        aria-label="Calibration diagnostic report"
        readonly
        rows="17"
        value={report}
        on:focus={(event) => event.currentTarget.select()}
        on:click={(event) => event.currentTarget.select()}
    ></textarea>
</details>

<style>
    .calibration-diagnostics {
        margin-top: 1em;
    }
    summary {
        cursor: pointer;
    }
    textarea {
        box-sizing: border-box;
        width: 100%;
        font-family: monospace;
        font-size: 12px;
        color: inherit;
        background: transparent;
        resize: vertical;
    }
</style>
