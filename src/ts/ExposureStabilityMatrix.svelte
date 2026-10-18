<script lang="ts">
    import GraphContainer from "./GraphContainer.svelte"
    import { i18n } from "./i18n"
    import { card_data, exposureStabilitySettings, fsrsPresetData } from "./stores"
    import {
        buildExposureStabilityMatrix,
        prepareExposureStabilityCards,
        validExposureStabilityThresholds,
    } from "./exposureStabilityMatrix"

    let repsLower: number | undefined = $exposureStabilitySettings.repsLower
    let repsUpper: number | undefined = $exposureStabilitySettings.repsUpper
    let s90Lower: number | undefined = $exposureStabilitySettings.s90Lower
    let s90Upper: number | undefined = $exposureStabilitySettings.s90Upper
    $: draft = { repsLower, repsUpper, s90Lower, s90Upper }
    $: valid = validExposureStabilityThresholds(draft)
    $: prepared = $card_data
        ? prepareExposureStabilityCards($card_data, $fsrsPresetData?.presetsByCard ?? {})
        : null
    $: matrix = prepared
        ? buildExposureStabilityMatrix(prepared.cards, $exposureStabilitySettings)
        : null
    $: rowLabels = [
        i18n("matrix-under-exposed", { value: $exposureStabilitySettings.repsLower }),
        i18n("matrix-middle-exposure", {
            low: $exposureStabilitySettings.repsLower,
            high: $exposureStabilitySettings.repsUpper,
        }),
        i18n("matrix-over-exposed", { value: $exposureStabilitySettings.repsUpper }),
    ]
    $: columnLabels = [
        i18n("matrix-unstable", { value: $exposureStabilitySettings.s90Lower }),
        i18n("matrix-middle-stability", {
            low: $exposureStabilitySettings.s90Lower,
            high: $exposureStabilitySettings.s90Upper,
        }),
        i18n("matrix-stable", { value: $exposureStabilitySettings.s90Upper }),
    ]
    function apply() {
        if (validExposureStabilityThresholds(draft)) exposureStabilitySettings.set({ ...draft })
    }
    const countFormat = new Intl.NumberFormat()
    const workloadFormat = new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })
</script>

<GraphContainer>
    <h1>{i18n("matrix-title")}</h1>
    <form class="thresholds" on:submit|preventDefault={apply}>
        <label>
            {i18n("matrix-reps-lower")}
            <input type="number" min="1" step="1" bind:value={repsLower} />
        </label>
        <label>
            {i18n("matrix-reps-upper")}
            <input type="number" min="2" step="1" bind:value={repsUpper} />
        </label>
        <label>
            {i18n("matrix-s90-lower")}
            <input type="number" min="0.0001" step="any" bind:value={s90Lower} />
        </label>
        <label>
            {i18n("matrix-s90-upper")}
            <input type="number" min="0.0001" step="any" bind:value={s90Upper} />
        </label>
        <button type="submit" disabled={!valid}>{i18n("matrix-apply")}</button>
    </form>
    {#if !valid}<p class="validation" role="status">{i18n("matrix-invalid-thresholds")}</p>{/if}
    {#if matrix}
        <table class="exposure-stability-matrix" aria-label={i18n("matrix-title")}>
            <thead>
                <tr>
                    <th scope="col">{i18n("matrix-reps-s90")}</th>
                    {#each columnLabels as label}<th scope="col">{label}</th>{/each}
                </tr>
            </thead>
            <tbody>
                {#each matrix.cells as row, r}
                    <tr>
                        <th scope="row">{rowLabels[r]}</th>
                        {#each row as cell}
                            <td
                                style:--matrix-heat={`${matrix.totalWorkload ? (30 * cell.workload) / matrix.totalWorkload : 0}%`}
                            >
                                <strong>{countFormat.format(cell.count)}</strong>
                                <span>{i18n("matrix-card-count-unit")}</span>
                                <span class="workload">
                                    {cell.workloadCards
                                        ? workloadFormat.format(cell.workload)
                                        : cell.count
                                          ? "—"
                                          : "0.00"}
                                </span>
                                <span>{i18n("matrix-workload-unit")}</span>
                            </td>
                        {/each}
                    </tr>
                {/each}
            </tbody>
        </table>
        <p class="matrix-total" aria-live="polite">
            {i18n("matrix-total", {
                count: countFormat.format(matrix.count),
                workload: $fsrsPresetData ? workloadFormat.format(matrix.totalWorkload) : "—",
            })}
        </p>
        {#if !$fsrsPresetData}<p role="status">{i18n("matrix-loading-workload")}</p>{/if}
        {#if $fsrsPresetData && matrix.workloadCards < matrix.count}
            <p>{i18n("matrix-missing-workload", { count: matrix.count - matrix.workloadCards })}</p>
        {/if}
        <p>{i18n("matrix-scope-help", { count: prepared?.excluded ?? 0 })}</p>
    {:else}<p role="status">{i18n("matrix-loading")}</p>{/if}
    <p>{i18n("matrix-workload-help")}</p>
</GraphContainer>

<style lang="scss">
    .thresholds {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.6em 1em;
    }
    .thresholds label {
        display: flex;
        flex-direction: column;
        gap: 0.2em;
    }
    input {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
    }
    button {
        justify-self: start;
    }
    .exposure-stability-matrix {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0.2em;
        margin-top: 1em;
        table-layout: fixed;
    }
    th {
        font-weight: 500;
        font-size: 0.85em;
        overflow-wrap: anywhere;
    }
    th:first-child {
        width: 23%;
        text-align: start;
    }
    td {
        text-align: center;
        padding: 0.65em 0.1em;
        background: color-mix(in srgb, var(--fg-link) var(--matrix-heat), transparent);
    }
    td strong,
    td span {
        display: block;
    }
    td strong {
        font-size: 1.2em;
        font-variant-numeric: tabular-nums;
    }
    td span {
        font-size: 0.8em;
    }
    .workload {
        margin-top: 0.45em;
        font-variant-numeric: tabular-nums;
    }
    .matrix-total {
        font-weight: 500;
    }
    .validation {
        color: var(--fg);
    }
</style>
