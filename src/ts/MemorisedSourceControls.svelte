<script lang="ts">
    import { i18n } from "./i18n"
    import {
        cancelRwkvMemorisedComputation,
        rwkvMemorisedStats,
        type MemorisedMode,
    } from "./stores"
    import Warning from "./Warning.svelte"

    export let mode: MemorisedMode
    export let supportsRwkv = true

    $: rwkvProgressPercent =
        $rwkvMemorisedStats?.total && $rwkvMemorisedStats.total > 0
            ? Math.min(
                  100,
                  Math.round((100 * $rwkvMemorisedStats.current) / $rwkvMemorisedStats.total)
              )
            : 0
</script>

<div class="memorised-source" role="group" aria-label={i18n("memorised-source")}>
    <label>
        <input type="radio" value="fsrs" bind:group={mode} />
        {i18n("memorised-source-fsrs")}
    </label>
    <label>
        <input type="radio" value="rwkv" bind:group={mode} />
        {i18n("memorised-source-rwkv")}
    </label>
    <label>
        <input type="radio" value="both" bind:group={mode} />
        {i18n("memorised-source-both")}
    </label>
</div>
{#if !supportsRwkv && mode !== "fsrs"}
    <Warning always>{i18n("memorised-rwkv-stability-unavailable")}</Warning>
{/if}
{#if mode !== "fsrs" && $rwkvMemorisedStats?.error}
    <Warning always>{$rwkvMemorisedStats.error}</Warning>
{:else if mode !== "fsrs" && $rwkvMemorisedStats && !$rwkvMemorisedStats.done}
    <div class="rwkv-progress">
        <div>
            {$rwkvMemorisedStats.phase === "checkpointing"
                ? i18n("memorised-rwkv-saving-checkpoint")
                : i18n("memorised-rwkv-progress", {
                      current: $rwkvMemorisedStats.current,
                      total: $rwkvMemorisedStats.total,
                      percent: rwkvProgressPercent,
                  })}
        </div>
        <progress
            max={$rwkvMemorisedStats.total || 1}
            value={$rwkvMemorisedStats.current}
            aria-label={i18n("memorised-rwkv-progress-label")}
        ></progress>
        <button
            type="button"
            disabled={$rwkvMemorisedStats.phase === "checkpointing"}
            on:click={() => cancelRwkvMemorisedComputation()}
        >
            {i18n("cancel")}
        </button>
    </div>
{/if}

<style>
    .memorised-source {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
    }

    .rwkv-progress {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 0.35rem 0.75rem;
        align-items: center;
        margin: 0.5rem 0;
    }

    .rwkv-progress div {
        grid-column: 1 / -1;
    }

    .rwkv-progress progress {
        width: 100%;
    }
</style>
