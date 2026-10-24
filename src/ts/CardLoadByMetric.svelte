<script lang="ts">
    import { rangeBarStringLabeler, type BarChart } from "./bar"
    import BarScrollable from "./BarScrollable.svelte"
    import {
        CARD_LOAD_PERCENTILE_BUCKET_SIZE,
        cardIdsByCardMetric,
        cardIdsByCardMetricPercentile,
        loadByCardMetric,
        loadByCardMetricPercentile,
        type CardLoadMetric,
    } from "./cardLoadSeries"
    import GraphContainer from "./GraphContainer.svelte"
    import { i18n, i18n_bundle } from "./i18n"
    import { browserSearchCids, browserSearchCurrent } from "./search"
    import { card_data } from "./stores"

    export let metric: CardLoadMetric
    export let titleKey: string
    export let helpKey: string
    export let metricLabelKey: string
    export let colour: string

    const default_visible_bins = 30
    const max_percentile_visible_bins = 100

    let bar_width = 1
    let scroll = 0
    let as_ratio = false
    let per_percentile = false
    let cumulative_mode = false
    let percentile_size = CARD_LOAD_PERCENTILE_BUCKET_SIZE
    let only_young = false

    $: percentile_bucket_size = Math.min(
        Math.max(Math.round(Number(percentile_size) || CARD_LOAD_PERCENTILE_BUCKET_SIZE), 1),
        100
    )
    $: visible_bins = per_percentile
        ? Math.max(
              default_visible_bins,
              Math.min(Math.ceil(100 / percentile_bucket_size), max_percentile_visible_bins)
          )
        : default_visible_bins
    $: card_filter = { onlyYoung: only_young }

    function percentileLabeler(label: string, width = 1) {
        const start = +label * percentile_bucket_size
        const end = Math.min(start + width * percentile_bucket_size, 100)
        return i18n("percentile-range", { start, end })
    }

    function metricSearch(metricValue: number, width: number) {
        const property = metric === "reps" ? "reps" : "lapses"
        const end = metricValue + width
        const metricRange = cumulative_mode
            ? `prop:${property}<${end}`
            : `prop:${property}>=${metricValue} prop:${property}<${end}`

        if (only_young) {
            const cids = cardIdsByCardMetric(
                $card_data ?? [],
                metric,
                metricValue,
                width,
                cumulative_mode,
                card_filter
            )
            if (cids.length) {
                browserSearchCids(cids)
            }
            return
        }

        browserSearchCurrent(`prop:reps>0 -is:suspended ${metricRange}`)
    }

    function percentileSearch(bucketStart: number, bucketWidth: number) {
        const cids = cardIdsByCardMetricPercentile(
            $card_data ?? [],
            metric,
            bucketStart,
            bucketWidth,
            cumulative_mode,
            percentile_bucket_size,
            card_filter
        )
        if (cids.length) {
            browserSearchCids(cids)
        }
    }

    function searchCards(start: number, width: number) {
        if (per_percentile) {
            percentileSearch(start, width)
        } else {
            metricSearch(start, width)
        }
    }

    $: load_series = per_percentile
        ? loadByCardMetricPercentile($card_data ?? [], metric, percentile_bucket_size, card_filter)
        : loadByCardMetric($card_data ?? [], metric, card_filter)

    $: value_label = as_ratio
        ? cumulative_mode
            ? i18n("cumulative-load-ratio")
            : i18n("load-ratio")
        : cumulative_mode
          ? i18n("cumulative-load")
          : i18n("load")

    $: bar_data = {
        row_labels: [value_label],
        row_colours: [colour],
        data: Array.from(load_series).map((load, metricValue) => ({
            values: [load ?? 0],
            label: metricValue.toString(),
        })),
        columnLabeler: per_percentile
            ? percentileLabeler
            : rangeBarStringLabeler(
                  i18n_bundle.getMessage("x-in-range")?.value!,
                  i18n(metricLabelKey)
              ),
        tick_spacing: per_percentile ? 2 : 5,
        precision: as_ratio ? 4 : 2,
    } satisfies BarChart
</script>

<GraphContainer graphId={`load:card-load-${metric}`}>
    <h1>{i18n(titleKey)}</h1>
    <BarScrollable
        data={bar_data}
        bind:binSize={bar_width}
        bind:offset={scroll}
        bins={visible_bins}
        left_aligned
        cumulative={cumulative_mode}
        asRatio={as_ratio}
        search={searchCards}
    />
    <label>
        <input type="checkbox" bind:checked={as_ratio} />
        {i18n("as-ratio")}
    </label>
    <label>
        <input type="checkbox" bind:checked={per_percentile} />
        {i18n("per-percentile")}
    </label>
    {#if per_percentile}
        <label>
            {i18n("percentile-size")}
            <input type="number" min="1" max="100" bind:value={percentile_size} />
        </label>
    {/if}
    <label>
        <input type="checkbox" bind:checked={cumulative_mode} />
        {i18n("cumulative-mode")}
    </label>
    <label>
        <input type="checkbox" bind:checked={only_young} />
        {i18n("only-young")}
    </label>
    <p>{i18n(helpKey)}</p>
</GraphContainer>
