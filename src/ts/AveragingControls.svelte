<script lang="ts">
    import type { AveragingMode } from "./dailyMovingAverage"
    import { i18n } from "./i18n"

    export let enabled = true
    export let mode: AveragingMode = "calendar"
    export let days = 7
    export let reviews = 1000
    export let connectGaps = true
    export let modes: AveragingMode[] = ["calendar", "study", "reviews"]

    const modeLabels: Record<AveragingMode, string> = {
        calendar: "averaging-calendar-days",
        study: "averaging-study-days",
        reviews: "averaging-reviews",
    }
    let draft: number | undefined = days
    let previousMode = mode
    $: if (mode !== previousMode) {
        previousMode = mode
        draft = mode === "reviews" ? reviews : days
    }

    function applyWindow() {
        if (typeof draft !== "number" || !Number.isSafeInteger(draft) || draft < 1) {
            draft = mode === "reviews" ? reviews : days
            return
        }
        if (mode === "reviews") reviews = draft
        else days = draft
    }
</script>

<div class="averaging-controls">
    <label class="average-toggle">
        <input type="checkbox" bind:checked={enabled} />
        {i18n("averaging-moving-average")}
    </label>
    <form on:submit|preventDefault={applyWindow}>
        <input
            aria-label={i18n("averaging-window-size")}
            type="number"
            min="1"
            step="1"
            required
            disabled={!enabled}
            bind:value={draft}
            on:change={applyWindow}
            on:blur={applyWindow}
        />
        {#if modes.length === 1}
            <span>{i18n(modeLabels[modes[0]])}</span>
        {:else}
            <select
                aria-label={i18n("averaging-window-type")}
                disabled={!enabled}
                bind:value={mode}
            >
                {#each modes as availableMode}
                    <option value={availableMode}>{i18n(modeLabels[availableMode])}</option>
                {/each}
            </select>
        {/if}
    </form>
    <label class="connect-gaps">
        <input type="checkbox" disabled={!enabled} bind:checked={connectGaps} />
        {i18n("averaging-connect-gaps")}
    </label>
</div>

<style>
    .averaging-controls,
    form,
    label {
        display: flex;
        align-items: center;
        gap: 0.45em;
    }
    .averaging-controls {
        flex-wrap: wrap;
        gap: 0.5em 0.9em;
        margin: 0.6em 0;
        font-size: 0.85em;
    }
    input[type="number"] {
        width: 5.5em;
    }
    select {
        max-width: 100%;
    }
</style>
