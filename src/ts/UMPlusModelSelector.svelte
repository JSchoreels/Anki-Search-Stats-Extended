<script lang="ts">
    import { i18n } from "./i18n"

    export let models: { id: string; label: string }[]
    export let first: string
    export let second: string
</script>

<div class="model-selector">
    <label>
        {i18n("um-plus-first-model")}
        <select bind:value={first}>
            {#each models as model}
                <option value={model.id}>{model.label}</option>
            {/each}
        </select>
    </label>
    <label>
        {i18n("um-plus-second-model")}
        <select bind:value={second}>
            {#each models as model}
                <option value={model.id}>{model.label}</option>
            {/each}
        </select>
    </label>
</div>

<style>
    .model-selector {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5em 1em;
    }

    label {
        display: flex;
        align-items: center;
        gap: 0.5em;
    }
</style>
