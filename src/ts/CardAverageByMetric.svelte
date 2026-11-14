<script lang="ts">
    import { averageForRange, cardMetricBuckets } from "./averageCardMetric"
    import { rangeBarStringLabeler, type BarChart } from "./bar"
    import BarScrollable from "./BarScrollable.svelte"
    import GraphContainer from "./GraphContainer.svelte"
    import { i18n, i18n_bundle } from "./i18n"
    import NoGraph from "./NoGraph.svelte"
    import { browserSearchCurrent } from "./search"
    import { card_data, include_suspended } from "./stores"

    export let metric: "reps" | "lapses"
    export let titleKey: string
    export let helpKey: string
    export let labelKey: string
    export let colour: string
    export let graphId: string
    export let valueKind: "load" | "repetitions" = "load"
    export let allowDivideByLapses = false

    let binSize = 1
    let offset = 0
    let divideByLapses = false
    $: buckets = cardMetricBuckets(
        $card_data ?? [],
        metric,
        $include_suspended,
        divideByLapses ? "repetitionsPerLapse" : valueKind
    )
    $: barData = {
        row_labels: [
            i18n(
                divideByLapses
                    ? "average-repetitions-per-lapse-plus-one"
                    : valueKind === "load"
                      ? "average-load-per-card"
                      : "average-repetitions-per-card"
            ),
        ],
        row_colours: [colour],
        data: Array.from(buckets, (bucket, index) => ({
            label: index.toString(),
            values: [bucket ? bucket.sum / bucket.count : 0],
        })),
        columnLabeler: rangeBarStringLabeler(
            i18n_bundle.getMessage("x-in-range")?.value!,
            i18n(labelKey)
        ),
        precision: 4,
    } satisfies BarChart

    function searchCards(start: number, width: number) {
        const suspended = $include_suspended ? "" : "-is:suspended "
        browserSearchCurrent(
            `prop:reps>0 ${suspended}prop:${metric}>=${start} prop:${metric}<${start + width}`
        )
    }
</script>

<GraphContainer {graphId}>
    <h1>{i18n(titleKey)}</h1>
    {#if $card_data}
        <BarScrollable
            data={barData}
            bind:binSize
            bind:offset
            left_aligned
            aggregateValues={(start, width) => [averageForRange(buckets, start, width)]}
            search={searchCards}
        />
        <label>
            <input type="checkbox" bind:checked={$include_suspended} />
            {i18n("include-suspended")}
        </label>
        {#if allowDivideByLapses}
            <label>
                <input type="checkbox" bind:checked={divideByLapses} />
                {i18n("divide-repetitions-by-lapses")}
            </label>
        {/if}
    {:else}
        <NoGraph />
    {/if}
    <p>{i18n(helpKey)}</p>
</GraphContainer>
