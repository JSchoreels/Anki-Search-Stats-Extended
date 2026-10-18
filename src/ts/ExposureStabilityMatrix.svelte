<script lang="ts">
    import GraphContainer from "./GraphContainer.svelte"
    import { i18n } from "./i18n"
    import { card_data, exposureStabilitySettings, fsrsPresetData } from "./stores"
    import {
        buildExposureStabilityMatrix,
        prepareExposureStabilityCards,
        validExposureStabilityThresholds,
        type ExposureStabilityCell,
    } from "./exposureStabilityMatrix"

    let repsLower: number | undefined = $exposureStabilitySettings.repsLower
    let repsUpper: number | undefined = $exposureStabilitySettings.repsUpper
    let s90Lower: number | undefined = $exposureStabilitySettings.s90Lower
    let s90Upper: number | undefined = $exposureStabilitySettings.s90Upper
    let thresholdsOpen = false
    $: draft = { repsLower, repsUpper, s90Lower, s90Upper }
    $: valid = validExposureStabilityThresholds(draft)
    $: prepared = $card_data
        ? prepareExposureStabilityCards($card_data, $fsrsPresetData?.presetsByCard ?? {})
        : null
    $: matrix = prepared
        ? buildExposureStabilityMatrix(prepared.cards, $exposureStabilitySettings)
        : null
    $: tableRows = matrix
        ? [
              ...matrix.cells.map((row, index) => [...row, matrix.rowTotals[index]]),
              [
                  ...matrix.columnTotals,
                  {
                      count: matrix.count,
                      workload: matrix.totalWorkload,
                      workloadCards: matrix.workloadCards,
                  },
              ],
          ]
        : []
    $: rowLabels = [
        i18n("matrix-under-exposed", { value: $exposureStabilitySettings.repsLower }),
        i18n("matrix-middle-exposure", {
            low: $exposureStabilitySettings.repsLower,
            high: $exposureStabilitySettings.repsUpper,
        }),
        i18n("matrix-over-exposed", { value: $exposureStabilitySettings.repsUpper }),
        i18n("matrix-total-label"),
    ]
    $: columnLabels = [
        i18n("matrix-unstable", { value: $exposureStabilitySettings.s90Lower }),
        i18n("matrix-middle-stability", {
            low: $exposureStabilitySettings.s90Lower,
            high: $exposureStabilitySettings.s90Upper,
        }),
        i18n("matrix-stable", { value: $exposureStabilitySettings.s90Upper }),
        i18n("matrix-total-label"),
    ]
    function apply() {
        if (validExposureStabilityThresholds(draft)) {
            exposureStabilitySettings.set({ ...draft })
            thresholdsOpen = false
        }
    }
    const countFormat = new Intl.NumberFormat()
    const workloadFormat = new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })
    function workloadValue(cell: ExposureStabilityCell) {
        return cell.workloadCards ? workloadFormat.format(cell.workload) : cell.count ? "—" : "0.00"
    }
</script>

<GraphContainer>
    <div class="matrix-heading">
        <h1>{i18n("matrix-title")}</h1>
        <span>{i18n("matrix-values-legend")}</span>
    </div>
    <details class="matrix-settings" bind:open={thresholdsOpen}>
        <summary>
            {i18n("matrix-threshold-summary", {
                repsLow: $exposureStabilitySettings.repsLower,
                repsHigh: $exposureStabilitySettings.repsUpper,
                sLow: $exposureStabilitySettings.s90Lower,
                sHigh: $exposureStabilitySettings.s90Upper,
            })}
        </summary>
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
    </details>
    {#if matrix}
        <table class="exposure-stability-matrix" aria-label={i18n("matrix-title")}>
            <thead>
                <tr>
                    <th scope="col">{i18n("matrix-reps-s90")}</th>
                    {#each columnLabels as label}<th scope="col">{label}</th>{/each}
                </tr>
            </thead>
            <tbody>
                {#each tableRows as row, r}
                    <tr>
                        <th scope="row">{rowLabels[r]}</th>
                        {#each row as cell, c}
                            <td
                                class:matrix-sum={r === 3 || c === 3}
                                style:--matrix-heat={`${r < 3 && c < 3 && matrix.totalWorkload ? (38 * cell.workload) / matrix.totalWorkload : 0}%`}
                            >
                                <strong>{countFormat.format(cell.count)}</strong>
                                <span class="workload">
                                    {i18n("matrix-workload-short", { value: workloadValue(cell) })}
                                </span>
                            </td>
                        {/each}
                    </tr>
                {/each}
            </tbody>
        </table>
        <p class="matrix-diagonal" aria-live="polite">
            {i18n("matrix-diagonal-total", {
                count: countFormat.format(matrix.diagonal.count),
                workload: workloadValue(matrix.diagonal),
            })}
        </p>
        {#if !$fsrsPresetData}<p role="status">{i18n("matrix-loading-workload")}</p>{/if}
        {#if $fsrsPresetData && matrix.workloadCards < matrix.count}
            <p>{i18n("matrix-missing-workload", { count: matrix.count - matrix.workloadCards })}</p>
        {/if}
    {:else}<p role="status">{i18n("matrix-loading")}</p>{/if}
    <details class="matrix-notes">
        <summary>{i18n("matrix-about")}</summary>
        <p>{i18n("matrix-scope-help", { count: prepared?.excluded ?? 0 })}</p>
        <p>{i18n("matrix-workload-help")}</p>
    </details>
</GraphContainer>

<style lang="scss">
    .matrix-heading {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.5em;
        margin-bottom: 0.9em;
    }
    .matrix-heading h1 {
        font-size: 1.15rem;
        font-weight: 500;
        border: 0;
        margin: 0;
        padding: 0;
    }
    .matrix-heading span,
    summary {
        font-size: 0.8em;
    }
    summary {
        cursor: pointer;
    }
    .matrix-settings summary {
        padding: 0.4em 0.6em;
        border-radius: 6px;
        background: color-mix(in srgb, var(--fg) 5%, transparent);
    }
    .matrix-notes {
        margin-top: 0.7em;
    }
    .thresholds {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.6em 1em;
        padding-top: 0.8em;
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
        font-size: 0.8em;
        overflow-wrap: anywhere;
    }
    th:first-child {
        width: 20%;
        text-align: start;
    }
    td {
        text-align: center;
        padding: 0.8em 0.1em;
        border-radius: 7px;
        background: color-mix(
            in srgb,
            var(--fg-link) var(--matrix-heat),
            color-mix(in srgb, var(--fg) 4%, transparent)
        );
    }
    td strong,
    td span {
        display: block;
    }
    td strong {
        font-size: 1.1em;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
    }
    td span {
        font-size: 0.8em;
    }
    .workload {
        margin-top: 0.25em;
        font-variant-numeric: tabular-nums;
    }
    .matrix-diagonal {
        font-weight: 500;
    }
    .matrix-sum {
        background: color-mix(in srgb, var(--fg) 8%, transparent);
    }
    .validation {
        color: var(--fg);
    }
</style>
