<script lang="ts">
    import { onMount, onDestroy } from "svelte"
    import GraphContainer from "./GraphContainer.svelte"
    import { i18n } from "./i18n"
    import { browserSearchCurrent } from "./search"
    import {
        activeRetrievabilityHistory,
        activeRetrievabilityRequested,
        activeRetrievabilitySettings,
    } from "./stores"
    import {
        buildActiveRetrievabilityMatrix,
        activeRetrievabilityCellSearch,
        validActiveRetrievabilityThresholds,
    } from "./activeRetrievabilityMatrix"
    onMount(() => {
        activeRetrievabilityRequested.set(true)
    })
    onDestroy(() => {
        activeRetrievabilityRequested.set(false)
    })
    const cellColors = [
        ["#8bc34a", "#8bc34a", "#ff8800"],
        ["#f4df00", "#8bc34a", "#f4df00"],
        ["#ef3213", "#f4df00", "#8bc34a"],
    ]
    let daysLower: number | undefined = $activeRetrievabilitySettings.daysLower
    let daysUpper: number | undefined = $activeRetrievabilitySettings.daysUpper
    let rLower: number | undefined = $activeRetrievabilitySettings.rLower
    let rUpper: number | undefined = $activeRetrievabilitySettings.rUpper
    let thresholdsOpen = false
    $: draft = { daysLower, daysUpper, rLower, rUpper }
    $: valid = validActiveRetrievabilityThresholds(draft)
    $: matrix = $activeRetrievabilityHistory
        ? buildActiveRetrievabilityMatrix(
              $activeRetrievabilityHistory.cards,
              $activeRetrievabilitySettings
          )
        : null
    $: tableRows = matrix
        ? [
              ...matrix.cells.map((row, i) => [...row, matrix.rowTotals[i]]),
              [...matrix.columnTotals, matrix.total],
          ]
        : []
    $: rowLabels = [
        i18n("active-r-low-days", { value: $activeRetrievabilitySettings.daysLower }),
        i18n("active-r-middle-days", {
            low: $activeRetrievabilitySettings.daysLower,
            high: $activeRetrievabilitySettings.daysUpper,
        }),
        i18n("active-r-high-days", { value: $activeRetrievabilitySettings.daysUpper }),
        i18n("matrix-total-label"),
    ]
    $: columnLabels = [
        i18n("active-r-low-r", { value: $activeRetrievabilitySettings.rLower }),
        i18n("active-r-middle-r", {
            low: $activeRetrievabilitySettings.rLower,
            high: $activeRetrievabilitySettings.rUpper,
        }),
        i18n("active-r-high-r", { value: $activeRetrievabilitySettings.rUpper }),
        i18n("matrix-total-label"),
    ]
    function apply() {
        if (validActiveRetrievabilityThresholds(draft)) {
            activeRetrievabilitySettings.set({ ...draft })
            thresholdsOpen = false
        }
    }
    const countFormat = new Intl.NumberFormat()
    const workloadFormat = new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })
</script>

<GraphContainer>
    <div class="matrix-heading">
        <h1>{i18n("active-r-title")}</h1>
        <span>{i18n("matrix-values-legend")}</span>
    </div>
    <details class="matrix-settings" bind:open={thresholdsOpen}>
        <summary>
            {i18n("active-r-threshold-summary", {
                daysLow: $activeRetrievabilitySettings.daysLower,
                daysHigh: $activeRetrievabilitySettings.daysUpper,
                rLow: $activeRetrievabilitySettings.rLower,
                rHigh: $activeRetrievabilitySettings.rUpper,
            })}
        </summary>
        <form class="thresholds" on:submit|preventDefault={apply}>
            <label>
                {i18n("active-r-days-lower")}
                <input type="number" min="1" step="1" bind:value={daysLower} />
            </label>
            <label>
                {i18n("active-r-days-upper")}
                <input type="number" min="2" step="1" bind:value={daysUpper} />
            </label>
            <label>
                {i18n("active-r-r-lower")}
                <input type="number" min="0.0001" max="100" step="any" bind:value={rLower} />
            </label>
            <label>
                {i18n("active-r-r-upper")}
                <input type="number" min="0.0001" max="100" step="any" bind:value={rUpper} />
            </label>
            <button type="submit" disabled={!valid}>{i18n("matrix-apply")}</button>
        </form>
        {#if !valid}<p class="validation" role="status">{i18n("active-r-invalid")}</p>{/if}
    </details>
    {#if matrix}
        <table class="exposure-stability-matrix" aria-label={i18n("active-r-title")}>
            <thead>
                <tr>
                    <th scope="col">{i18n("active-r-axes")}</th>
                    {#each columnLabels as label}<th scope="col">{label}</th>{/each}
                </tr>
            </thead>
            <tbody>
                {#each tableRows as row, r}<tr>
                        <th scope="row">{rowLabels[r]}</th>
                        {#each row as cell, c}
                            <td
                                class:matrix-sum={r === 3 || c === 3}
                                style:--matrix-color={cellColors[r]?.[c] ?? "transparent"}
                            >
                                <button
                                    type="button"
                                    class="matrix-cell"
                                    aria-label={i18n("matrix-browse-cell", {
                                        count: countFormat.format(cell.count),
                                        row: rowLabels[r],
                                        column: columnLabels[c],
                                    })}
                                    on:click={() =>
                                        browserSearchCurrent(activeRetrievabilityCellSearch(cell))}
                                >
                                    <strong>{countFormat.format(cell.count)}</strong>
                                    <span class="workload">
                                        {i18n("matrix-workload-short", {
                                            value: workloadFormat.format(cell.workload),
                                        })}
                                    </span>
                                </button>
                            </td>
                        {/each}
                    </tr>{/each}
            </tbody>
        </table>
        <button
            type="button"
            class="matrix-diagonal"
            on:click={() => browserSearchCurrent(activeRetrievabilityCellSearch(matrix.diagonal))}
        >
            {i18n("matrix-diagonal-total", {
                count: countFormat.format(matrix.diagonal.count),
                workload: workloadFormat.format(matrix.diagonal.workload),
            })}
        </button>
        <p role="status">
            {i18n("active-r-coverage", {
                count: matrix.total.count,
                excluded: $activeRetrievabilityHistory?.excluded ?? 0,
                incomplete: $activeRetrievabilityHistory?.incomplete ?? 0,
            })}
        </p>
    {:else}<p role="status">{i18n("active-r-loading")}</p>{/if}
    <details class="matrix-notes">
        <summary>{i18n("matrix-about")}</summary>
        <p>{i18n("active-r-help")}</p>
        <p>{i18n("active-r-workload-help")}</p>
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
        padding: 0;
        border-radius: 7px;
        background: color-mix(
            in srgb,
            var(--matrix-color) 24%,
            color-mix(in srgb, var(--fg) 4%, transparent)
        );
    }
    .matrix-cell {
        display: block;
        width: 100%;
        box-sizing: border-box;
        margin: 0;
        padding: 0.8em 0.1em;
        border: 0;
        border-radius: inherit;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: inherit;
        cursor: pointer;
    }
    .matrix-cell:hover {
        background: color-mix(in srgb, var(--fg) 8%, transparent);
    }
    .matrix-cell:focus-visible {
        outline: 2px solid var(--fg-link, var(--fg));
        outline-offset: -2px;
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
        display: block;
        margin: 1em 0;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-weight: 500;
        text-align: start;
        cursor: pointer;
    }
    .matrix-diagonal:hover {
        text-decoration: underline;
    }
    .matrix-diagonal:focus-visible {
        outline: 2px solid var(--fg-link, var(--fg));
        outline-offset: 3px;
    }
    .matrix-sum {
        background: color-mix(in srgb, var(--fg) 8%, transparent);
    }
    .validation {
        color: var(--fg);
    }
</style>
