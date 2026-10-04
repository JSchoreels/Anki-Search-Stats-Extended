<script lang="ts">
    import * as _ from "lodash"
    import { type BarChart, type ExtraRenderInput } from "./bar"
    import BarScrollable from "./BarScrollable.svelte"
    import { calculateEaseFactors } from "./easeFactor"
    import { i18n } from "./i18n"
    import { catchErrors } from "./search"
    import { card_data } from "./stores"
    import * as d3 from "d3"

    $: easeFactors = catchErrors(() =>
        calculateEaseFactors($card_data ?? [], SSEother.deck_configs, SSEother.deck_config_ids)
    )

    let data = <number[]>[]
    $: {
        data = []
        for (const factor of easeFactors) {
            const index = Math.floor(factor * 100)
            data[index] = (data[index] ?? 0) + 1
        }
    }

    let graph: BarChart
    $: graph = {
        row_labels: [i18n("cards")],
        row_colours: ["steelblue"],
        data: Array.from(data).map((a, i) => ({
            values: [a ?? 0],
            label: (i / 100).toFixed(2),
        })),
        tick_spacing: 5,
        columnLabeler: (label, width = 1) =>
            i18n("stability-multiplied-by", {
                value: `${(Number(label) / 100).toFixed(2)}–${((Number(label) + width) / 100).toFixed(2)}`,
            }),
    }

    $: max = (d3.quantile(easeFactors, 0.99) ?? 1) * 100
    const bins = 30
    $: offset = Math.min(100, Math.floor((d3.min(easeFactors) ?? 1) * 100))
    $: binSize = Math.max(1, Math.ceil((max - offset) / bins))

    function formatAxis({ svg }: ExtraRenderInput<BarChart>) {
        svg.select(":scope > g[transform]")
            .selectAll(".tick text")
            .text((label) => (Number(label) / 100).toFixed(2))
    }
</script>

<BarScrollable data={graph} left_aligned {offset} {bins} {binSize} extraRender={formatAxis}
></BarScrollable>
