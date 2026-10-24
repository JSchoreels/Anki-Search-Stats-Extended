<script lang="ts">
    import { i18n } from "./i18n"
    export let zoomed = false
    export let reset: () => void
</script>

<div class="zoom-controls">
    <span>{i18n("graph-drag-zoom-help")}</span>
    {#if zoomed}<button type="button" on:click={reset}>{i18n("graph-reset-zoom")}</button>{/if}
</div>

<style>
    .zoom-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5em 1em;
        font-size: 0.8em;
        margin: 0.5em 0;
    }
    span {
        opacity: 0.7;
    }
    @media print {
        .zoom-controls {
            display: none;
        }
    }
</style>
