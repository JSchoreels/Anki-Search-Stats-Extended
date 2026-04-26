<script lang="ts">
    import type { BarChart } from "../bar"
    import BarScrollable from "../BarScrollable.svelte"
    import RevlogGraphContainer from "../RevlogGraphContainer.svelte"
    import IntervalGraph from "../IntervalGraph.svelte"
    import GraphCategory from "../GraphCategory.svelte"
    import { i18n, i18n_pattern } from "../i18n"
    import { memorised_stats, pieLast, pieSteps, revlogStats } from "../stores"

    enum AverageType {
        MEAN,
        MEDIAN,
    }

    let averageType = AverageType.MEAN
    let retrievabilityBinSize = 2
    let retrievabilityExcludeSameDay = true
    let retrievabilitySuccessOnly = false
    let stabilityBinSize = 2
    let difficultyBinSize = 1
    let repetitionBinSize = 1

    function retrievabilityBucketLabeler(label: string, width = 1) {
        const raw = Number(label)
        const start = raw < 0 ? 99 + raw : raw
        const end = Math.min(100, start + width)
        return i18n("retrievability-of", { value: `${start}-${end}%` })
    }

    function stabilityBucketLabeler(label: string, width = 1) {
        const start = Number(label)
        const end = width > 1 ? `${start}-${start + width - 1}` : label
        return i18n("stability-of", { value: end })
    }

    function difficultyBucketLabeler(label: string, width = 1) {
        const start = (Number(label) + 1) / 10
        const end = (Number(label) + width) / 10
        const value = width > 1 ? `${start.toFixed(1)}-${end.toFixed(1)}` : start.toFixed(1)
        return i18n("difficulty-of", { value })
    }

    function repetitionBucketLabeler(label: string, width = 1) {
        const start = Number(label)
        return width > 1 ? `${start}-${start + width - 1}` : label
    }

    $: retrievabilitySeries = (() => {
        if (averageType === AverageType.MEAN) {
            if (retrievabilityExcludeSameDay && retrievabilitySuccessOnly) {
                return (
                    $memorised_stats?.time_by_retrievability_mean_success_only_exclude_same_day ??
                    []
                )
            }
            if (retrievabilityExcludeSameDay) {
                return $memorised_stats?.time_by_retrievability_mean_exclude_same_day ?? []
            }
            if (retrievabilitySuccessOnly) {
                return $memorised_stats?.time_by_retrievability_mean_success_only ?? []
            }
            return $memorised_stats?.time_by_retrievability_mean ?? []
        }
        if (retrievabilityExcludeSameDay && retrievabilitySuccessOnly) {
            return (
                $memorised_stats?.time_by_retrievability_median_success_only_exclude_same_day ?? []
            )
        }
        if (retrievabilityExcludeSameDay) {
            return $memorised_stats?.time_by_retrievability_median_exclude_same_day ?? []
        }
        if (retrievabilitySuccessOnly) {
            return $memorised_stats?.time_by_retrievability_median_success_only ?? []
        }
        return $memorised_stats?.time_by_retrievability_median ?? []
    })()

    let retrievabilityTimeBar: BarChart
    $: retrievabilityTimeBar = {
        row_colours: ["#fcba03"],
        row_labels: [i18n("seconds")],
        data: Array.from(retrievabilitySeries).map((value, bucket) => ({
            values: [value ?? 0],
            label: bucket.toString(),
        })),
        tick_spacing: 10,
        columnLabeler: retrievabilityBucketLabeler,
    }

    $: stabilitySeries =
        averageType === AverageType.MEAN
            ? ($memorised_stats?.time_by_stability_mean ?? [])
            : ($memorised_stats?.time_by_stability_median ?? [])

    let stabilityTimeBar: BarChart
    $: stabilityTimeBar = {
        row_colours: ["#fcba03"],
        row_labels: [i18n("seconds")],
        data: Array.from(stabilitySeries).map((value, bucket) => ({
            values: [value ?? 0],
            label: bucket.toString(),
        })),
        tick_spacing: 10,
        columnLabeler: stabilityBucketLabeler,
    }

    $: difficultySeries =
        averageType === AverageType.MEAN
            ? ($memorised_stats?.time_by_difficulty_mean ?? [])
            : ($memorised_stats?.time_by_difficulty_median ?? [])

    let difficultyTimeBar: BarChart
    $: difficultyTimeBar = {
        row_colours: ["#fcba03"],
        row_labels: [i18n("seconds")],
        data: Array.from(difficultySeries).map((value, bucket) => ({
            values: [value ?? 0],
            label: bucket.toString(),
        })),
        tick_spacing: 10,
        columnLabeler: difficultyBucketLabeler,
    }

    $: repetitionSeries =
        averageType === AverageType.MEAN
            ? ($revlogStats?.time_by_repetition_mean ?? [])
            : ($revlogStats?.time_by_repetition_median ?? [])

    let repetitionTimeBar: BarChart
    $: repetitionTimeBar = {
        row_colours: ["#fcba03"],
        row_labels: [i18n("seconds")],
        data: Array.from(repetitionSeries).map((value, bucket) => ({
            values: [value ?? 0],
            label: bucket.toString(),
        })),
        tick_spacing: 10,
        columnLabeler: repetitionBucketLabeler,
    }
</script>

<GraphCategory hidden_title={i18n("time-distribution")} config_name="time">
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("time-distribution")}</h1>
        <IntervalGraph
            slot="graph"
            intervals={$revlogStats?.revlog_times ?? []}
            bind:last={$pieLast}
            bind:steps={$pieSteps}
            include_suspended_option={false}
            pieInfo={{
                countDescriptor: i18n("most-seconds"),
                spectrumFrom: "#fcba03",
                spectrumTo: "#543e00",
                fillerColour: "blue",
                legend_left: i18n("time-in-seconds"),
            }}
        ></IntervalGraph>
        <p>{i18n("time-distribution-help")}</p>
        <p>
            {i18n("suspended-cards-warning")}
        </p>
    </RevlogGraphContainer>
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("time-totals")}</h1>
        <IntervalGraph
            slot="graph"
            intervals={($revlogStats?.revlog_times ?? []).map((i, a) => i * a)}
            bind:last={$pieLast}
            bind:steps={$pieSteps}
            include_suspended_option={false}
            pieInfo={{
                countDescriptor: i18n("most-seconds"),
                spectrumFrom: "#fcba03",
                spectrumTo: "#543e00",
                fillerColour: "blue",
                legend_left: i18n("seconds-per-card"),
                legend_right: i18n("total-seconds"),
                totalDescriptor: i18n("seconds"),
            }}
        ></IntervalGraph>
        <p>
            {i18n("time-totals-help")}
        </p>
    </RevlogGraphContainer>
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("time-distribution-by-retrievability")}</h1>
        <BarScrollable
            slot="graph"
            data={retrievabilityTimeBar}
            average
            bind:binSize={retrievabilityBinSize}
            trend
            trend_info={{ pattern: i18n_pattern("average-second-per-retrievability-percent") }}
        />
        <div class="toggle">
            <label>
                <input type="radio" value={AverageType.MEAN} bind:group={averageType} />
                {i18n("mean")}
            </label>
            <label>
                <input type="radio" value={AverageType.MEDIAN} bind:group={averageType} />
                {i18n("median")}
            </label>
            <label>
                <input type="checkbox" bind:checked={retrievabilityExcludeSameDay} />
                {i18n("exclude-same-day-reviews")}
            </label>
            <label>
                <input type="checkbox" bind:checked={retrievabilitySuccessOnly} />
                {i18n("success-only-hard-good-easy")}
            </label>
        </div>
        <p>{i18n("time-distribution-by-retrievability-help")}</p>
    </RevlogGraphContainer>
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("time-distribution-by-stability")}</h1>
        <BarScrollable
            slot="graph"
            data={stabilityTimeBar}
            average
            left_aligned
            bind:binSize={stabilityBinSize}
            trend
            trend_info={{ pattern: i18n_pattern("average-second-per-stability-day") }}
        />
        <div class="toggle">
            <label>
                <input type="radio" value={AverageType.MEAN} bind:group={averageType} />
                {i18n("mean")}
            </label>
            <label>
                <input type="radio" value={AverageType.MEDIAN} bind:group={averageType} />
                {i18n("median")}
            </label>
        </div>
        <p>{i18n("time-distribution-by-stability-help")}</p>
    </RevlogGraphContainer>
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("time-distribution-by-repetitions")}</h1>
        <BarScrollable
            slot="graph"
            data={repetitionTimeBar}
            average
            left_aligned
            bind:binSize={repetitionBinSize}
            trend
            trend_info={{ pattern: i18n_pattern("average-second-per-repetition") }}
        />
        <div class="toggle">
            <label>
                <input type="radio" value={AverageType.MEAN} bind:group={averageType} />
                {i18n("mean")}
            </label>
            <label>
                <input type="radio" value={AverageType.MEDIAN} bind:group={averageType} />
                {i18n("median")}
            </label>
        </div>
        <p>{i18n("time-distribution-by-repetitions-help")}</p>
    </RevlogGraphContainer>
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("time-distribution-by-difficulty")}</h1>
        <BarScrollable
            slot="graph"
            data={difficultyTimeBar}
            average
            left_aligned
            bins={100}
            bind:binSize={difficultyBinSize}
            trend
            trend_info={{ pattern: i18n_pattern("average-second-per-difficulty") }}
        />
        <div class="toggle">
            <label>
                <input type="radio" value={AverageType.MEAN} bind:group={averageType} />
                {i18n("mean")}
            </label>
            <label>
                <input type="radio" value={AverageType.MEDIAN} bind:group={averageType} />
                {i18n("median")}
            </label>
        </div>
        <p>{i18n("time-distribution-by-difficulty-help")}</p>
    </RevlogGraphContainer>
</GraphCategory>

<style>
    div.toggle {
        display: flex;
        flex-wrap: wrap;
        gap: 1em;
        margin-top: 0.5em;
    }
</style>
