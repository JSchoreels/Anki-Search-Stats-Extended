<script lang="ts">
    import ActiveRetrievabilityMatrix from "../ActiveRetrievabilityMatrix.svelte"
    import ExposureStabilityMatrix from "../ExposureStabilityMatrix.svelte"
    import CardAverageByMetric from "../CardAverageByMetric.svelte"
    import GraphContainer from "../GraphContainer.svelte"
    import IntervalGraph from "../IntervalGraph.svelte"
    import GraphCategory from "../GraphCategory.svelte"
    import RevlogGraphContainer from "../RevlogGraphContainer.svelte"
    import { i18n } from "../i18n"
    import { catchErrors, type CardData } from "../search"
    import {
        graph_mode,
        zero_inclusive,
        card_data,
        cardDataStats,
        include_suspended,
        revlogStats,
    } from "../stores"

    let cardData: CardData[] | null = $card_data

    $: true_zero_inclusive = $zero_inclusive || $graph_mode == "Bar"
    $: ({ lapses, lapses_burden } = $cardDataStats)

    let lapse_last = 7
    let lapse_steps = 7
    let lapse_rate_last = 100
    let lapse_rate_steps = 10
    $: lapse_rates = $include_suspended
        ? $revlogStats?.lapse_rates.all
        : $revlogStats?.lapse_rates.active
</script>

<GraphCategory hidden_title={i18n("lapse-distribution")} config_name="lapse">
    <GraphContainer graphId="lapse:lapse-load">
        <h1>{i18n("lapse-load")}</h1>
        <IntervalGraph
            intervals={lapses_burden}
            bind:steps={lapse_steps}
            bind:last={lapse_last}
            pieInfo={{
                totalDescriptor: i18n("load"),
                countDescriptor: i18n("highest-lapse-count"),
                legend_left: i18n("lapse-count"),
                legend_right: i18n("card-load"),
                spectrumFrom: "#bd3f09",
                spectrumTo: "#612207",
            }}
            zero_inclusive_option
        ></IntervalGraph>
        <p>
            {i18n("lapse-load-help")}
        </p>
    </GraphContainer>
    <CardAverageByMetric
        graphId="lapse:average-load"
        metric="lapses"
        titleKey="average-load-by-lapses"
        helpKey="average-load-by-lapses-help"
        labelKey="lapse-count"
        colour="#bd3f09"
    />
    <CardAverageByMetric
        graphId="lapse:average-repetitions"
        metric="lapses"
        valueKind="repetitions"
        titleKey="average-repetitions-by-lapses"
        helpKey="average-repetitions-by-lapses-help"
        labelKey="lapse-count"
        colour="#5ca7f7"
        allowDivideByLapses
    />
    <GraphContainer graphId="lapse:lapse-distribution">
        <h1>{i18n("lapse-distribution")}</h1>
        <IntervalGraph
            intervals={lapses}
            bind:steps={lapse_steps}
            bind:last={lapse_last}
            pieInfo={{
                countDescriptor: i18n("highest-lapse-count"),
                legend_left: i18n("lapse-count"),
                legend_right: i18n("card-count"),
                spectrumFrom: "#bd3f09",
                spectrumTo: "#612207",
            }}
            zero_inclusive_option
        ></IntervalGraph>
        <p>
            {i18n("lapse-distribution-help")}
        </p>
    </GraphContainer>
    <GraphContainer graphId="lapse:lapse-total">
        <h1>{i18n("lapse-total")}</h1>
        <IntervalGraph
            intervals={lapses.map((e, i) => e * i)}
            bind:steps={lapse_steps}
            bind:last={lapse_last}
            pieInfo={{
                totalDescriptor: i18n("lapses"),
                countDescriptor: i18n("highest-lapse-count"),
                legend_left: i18n("lapse-count"),
                legend_right: i18n("lapse-total"),
                spectrumFrom: "#bd3f09",
                spectrumTo: "#612207",
            }}
            zero_inclusive_option
        ></IntervalGraph>
        <p>
            {i18n("lapse-total-help")}
        </p>
    </GraphContainer>
    <RevlogGraphContainer graphId="lapse:lapse-rate-by-introduction">
        <h1 slot="title">{i18n("lapse-rate-by-introduction")}</h1>
        <IntervalGraph
            slot="graph"
            intervals={lapse_rates ?? null}
            bind:last={lapse_rate_last}
            bind:steps={lapse_rate_steps}
            pieInfo={{
                countDescriptor: i18n("lapse-rate-highest"),
                legend_left: i18n("lapses-per-100-days"),
                legend_right: i18n("card-count"),
                spectrumFrom: "#bd3f09",
                spectrumTo: "#612207",
            }}
        />
        <p>{i18n("lapse-rate-by-introduction-help")}</p>
    </RevlogGraphContainer>
    <ExposureStabilityMatrix />
    <ActiveRetrievabilityMatrix />
</GraphCategory>
