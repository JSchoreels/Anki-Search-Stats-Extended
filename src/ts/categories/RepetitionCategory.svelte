<script lang="ts">
    import GraphContainer from "../GraphContainer.svelte"
    import CardAverageByMetric from "../CardAverageByMetric.svelte"
    import IntervalGraph from "../IntervalGraph.svelte"
    import GraphCategory from "../GraphCategory.svelte"
    import { i18n } from "../i18n"
    import { catchErrors, type CardData } from "../search"
    import {
        include_suspended,
        graph_mode,
        zero_inclusive,
        card_data,
        cardDataStats,
    } from "../stores"

    let cardData: CardData[] | null = $card_data

    $: true_zero_inclusive = $zero_inclusive || $graph_mode == "Bar"
    $: ({ repetitions, repetitions_burden } = $cardDataStats)

    let repetitions_last = 21
    let repetitions_steps = 7
</script>

<GraphCategory hidden_title={i18n("repetition-distribution")} config_name="repetition">
    <GraphContainer graphId="repetition:repetition-load">
        <h1>{i18n("repetition-load")}</h1>
        <IntervalGraph
            intervals={repetitions_burden}
            bind:steps={repetitions_steps}
            bind:last={repetitions_last}
            pieInfo={{
                totalDescriptor: i18n("load"),
                countDescriptor: i18n("highest-repetition-count"),
                legend_left: i18n("repetition-count"),
                legend_right: i18n("card-load"),
                spectrumFrom: "#5ca7f7",
                spectrumTo: "#0b4f99",
            }}
        />
        <p>
            {i18n("repetition-load-help")}
        </p>
    </GraphContainer>
    <CardAverageByMetric
        graphId="repetition:average-load"
        metric="reps"
        titleKey="average-load-by-repetitions"
        helpKey="average-load-by-repetitions-help"
        labelKey="repetition-count"
        colour="#5ca7f7"
    />
    <GraphContainer graphId="repetition:repetition-distribution">
        <h1>{i18n("repetition-distribution")}</h1>
        <IntervalGraph
            intervals={repetitions}
            bind:steps={repetitions_steps}
            bind:last={repetitions_last}
            pieInfo={{
                countDescriptor: i18n("highest-repetition-count"),
                legend_left: i18n("repetition-count"),
                legend_right: i18n("card-count"),
                spectrumFrom: "#5ca7f7",
                spectrumTo: "#0b4f99",
            }}
        />
        <p>{i18n("repetition-distribution-help")}</p>
    </GraphContainer>
    <GraphContainer graphId="repetition:repetition-total">
        <h1>{i18n("repetition-total")}</h1>
        <IntervalGraph
            intervals={repetitions.map((e, i) => e * i)}
            bind:steps={repetitions_steps}
            bind:last={repetitions_last}
            pieInfo={{
                totalDescriptor: i18n("total-repetitions"),
                countDescriptor: i18n("highest-repetition-count"),
                legend_left: i18n("repetition-count"),
                legend_right: i18n("repetition-total"),
                spectrumFrom: "#5ca7f7",
                spectrumTo: "#0b4f99",
            }}
        />
        <p>
            {i18n("repetition-total-help")}
        </p>
    </GraphContainer>
</GraphCategory>
