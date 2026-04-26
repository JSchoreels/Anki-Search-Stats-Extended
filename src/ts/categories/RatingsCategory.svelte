<script lang="ts">
    import RevlogGraphContainer from "../RevlogGraphContainer.svelte"
    import BarScrollable from "../BarScrollable.svelte"
    import GraphCategory from "../GraphCategory.svelte"
    import MatureFilterSelector from "../MatureFilterSelector.svelte"
    import { i18n, i18n_bundle, i18n_pattern } from "../i18n"
    import { TREND_PERSISTENCE_KEYS } from "../trendPersistenceKeys"
    import { barDateLabeler, barStringLabeler } from "../bar"
    import { binSize, scroll, searchLimit, revlogStats } from "../stores"
    import { today, easeBarChart, type RevlogBuckets } from "../revlogGraphs"
    import _ from "lodash"

    $: limit = -1 - $searchLimit
    let normalize_ease = false
    let mature_filter: keyof RevlogBuckets = "not_learn"
    let interval_scroll = 1
    let interval_bin_size = 1
    let retrievabilityBinSize = 2
    let retrievabilityExcludeSameDay = true
    let gradeSuccessOnly = false
    let stabilityBinSize = 2
    let repetitionsBinSize = 1
    let difficultyBinSize = 1

    let retention_trend = (values: number[]) => (_.sum(values) == 0 ? 0 : 1 - values[3])

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

    function repetitionsBucketLabeler(label: string, width = 1) {
        const start = Number(label)
        return width > 1 ? `${start}-${start + width - 1}` : label
    }

    function difficultyBucketLabeler(label: string, width = 1) {
        const start = (Number(label) + 1) / 10
        const end = (Number(label) + width) / 10
        const value = width > 1 ? `${start.toFixed(1)}-${end.toFixed(1)}` : start.toFixed(1)
        return i18n("difficulty-of", { value })
    }

    $: gradeByRetrievabilitySeries = (() => {
        if (retrievabilityExcludeSameDay && gradeSuccessOnly) {
            return $revlogStats?.grade_by_retrievability_success_only_exclude_same_day ?? []
        }
        if (retrievabilityExcludeSameDay) {
            return $revlogStats?.grade_by_retrievability_exclude_same_day ?? []
        }
        if (gradeSuccessOnly) {
            return $revlogStats?.grade_by_retrievability_success_only ?? []
        }
        return $revlogStats?.grade_by_retrievability ?? []
    })()

    $: gradeByStabilitySeries = gradeSuccessOnly
        ? ($revlogStats?.grade_by_stability_success_only ?? [])
        : ($revlogStats?.grade_by_stability ?? [])

    $: gradeByRepetitionsSeries = gradeSuccessOnly
        ? ($revlogStats?.grade_by_repetitions_success_only ?? [])
        : ($revlogStats?.grade_by_repetitions ?? [])

    $: gradeByDifficultySeries = gradeSuccessOnly
        ? ($revlogStats?.grade_by_difficulty_success_only ?? [])
        : ($revlogStats?.grade_by_difficulty ?? [])
</script>

<GraphCategory hidden_title={i18n("ratings")} config_name="rating">
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("ratings")}</h1>
        <BarScrollable
            slot="graph"
            data={easeBarChart(
                ($revlogStats?.day_ease ?? {})[mature_filter] ?? [],
                today,
                normalize_ease,
                barDateLabeler
            )}
            bind:binSize={$binSize}
            bind:offset={$scroll}
            average={normalize_ease}
            trend={normalize_ease}
            trend_date_axis
            trendPersistenceKey={TREND_PERSISTENCE_KEYS.ratings.ratings}
            trend_by={retention_trend}
            trend_info={{ pattern: i18n_pattern("retention-per-day"), percentage: true }}
            {limit}
        />
        <label>
            <input type="checkbox" bind:checked={normalize_ease} />
            {i18n("as-ratio")}
        </label>
        <MatureFilterSelector bind:group={mature_filter} />
        <p>
            {i18n("ratings-help")}
        </p>
    </RevlogGraphContainer>
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("ratings-by-duration")}</h1>
        <BarScrollable
            slot="graph"
            data={easeBarChart(
                ($revlogStats?.day_ease_time ?? {})[mature_filter] ?? [],
                today,
                normalize_ease,
                barDateLabeler
            )}
            bind:binSize={$binSize}
            bind:offset={$scroll}
            average={normalize_ease}
            trend={normalize_ease}
            trend_date_axis
            trendPersistenceKey={TREND_PERSISTENCE_KEYS.ratings.ratingsByDuration}
            trend_by={retention_trend}
            trend_info={{ pattern: i18n_pattern("retention-per-day"), percentage: true }}
            {limit}
        />
        <label>
            <input type="checkbox" bind:checked={normalize_ease} />
            {i18n("as-ratio")}
        </label>
        <MatureFilterSelector bind:group={mature_filter} />
        <p>
            {i18n("ratings-by-duration-help")}
        </p>
    </RevlogGraphContainer>
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("interval-ratings")}</h1>
        <BarScrollable
            slot="graph"
            data={easeBarChart(
                $revlogStats?.interval_ease ?? [],
                1,
                normalize_ease,
                barStringLabeler(i18n_bundle.getMessage("interval-of")?.value!)
            )}
            bind:binSize={interval_bin_size}
            bind:offset={interval_scroll}
            average={normalize_ease}
            left_aligned
            trend={normalize_ease}
            trendPersistenceKey={TREND_PERSISTENCE_KEYS.ratings.intervalRatings}
            trend_by={retention_trend}
            trend_info={{
                pattern: i18n_pattern("retention-per-day-greater-interval"),
                percentage: true,
            }}
        />
        <label>
            <input type="checkbox" bind:checked={normalize_ease} />
            {i18n("as-ratio")}
        </label>
        <p>{i18n("interval-ratings-help")}</p>
    </RevlogGraphContainer>
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("time-ratings")}</h1>
        <BarScrollable
            slot="graph"
            data={easeBarChart(
                ($revlogStats?.time_ease_seconds ?? {})[mature_filter] ?? [],
                0,
                normalize_ease,
                barStringLabeler(i18n_bundle.getMessage("x-seconds")?.value!)
            )}
            average={normalize_ease}
            left_aligned
            trend={normalize_ease}
            trendPersistenceKey={TREND_PERSISTENCE_KEYS.ratings.timeRatings}
            trend_by={retention_trend}
            trend_info={{ pattern: i18n_pattern("retention-per-second-spent"), percentage: true }}
        />
        <label>
            <input type="checkbox" bind:checked={normalize_ease} />
            {i18n("as-ratio")}
        </label>

        <MatureFilterSelector bind:group={mature_filter} />
        <p>
            {i18n("time-ratings-help")}
        </p>
    </RevlogGraphContainer>
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("grade-distribution-by-retrievability")}</h1>
        <BarScrollable
            slot="graph"
            data={easeBarChart(
                gradeByRetrievabilitySeries,
                0,
                normalize_ease,
                retrievabilityBucketLabeler
            )}
            average={normalize_ease}
            bind:binSize={retrievabilityBinSize}
        />
        <label>
            <input type="checkbox" bind:checked={normalize_ease} />
            {i18n("as-ratio")}
        </label>
        <div class="toggle">
            <label>
                <input type="checkbox" bind:checked={retrievabilityExcludeSameDay} />
                {i18n("exclude-same-day-reviews")}
            </label>
            <label>
                <input type="checkbox" bind:checked={gradeSuccessOnly} />
                {i18n("success-only-hard-good-easy")}
            </label>
        </div>
        <p>{i18n("grade-distribution-by-retrievability-help")}</p>
    </RevlogGraphContainer>
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("grade-distribution-by-stability")}</h1>
        <BarScrollable
            slot="graph"
            data={easeBarChart(gradeByStabilitySeries, 0, normalize_ease, stabilityBucketLabeler)}
            average={normalize_ease}
            left_aligned
            bind:binSize={stabilityBinSize}
        />
        <label>
            <input type="checkbox" bind:checked={normalize_ease} />
            {i18n("as-ratio")}
        </label>
        <div class="toggle">
            <label>
                <input type="checkbox" bind:checked={gradeSuccessOnly} />
                {i18n("success-only-hard-good-easy")}
            </label>
        </div>
        <p>{i18n("grade-distribution-by-stability-help")}</p>
    </RevlogGraphContainer>
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("grade-distribution-by-repetitions")}</h1>
        <BarScrollable
            slot="graph"
            data={easeBarChart(
                gradeByRepetitionsSeries,
                0,
                normalize_ease,
                repetitionsBucketLabeler
            )}
            average={normalize_ease}
            left_aligned
            bind:binSize={repetitionsBinSize}
        />
        <label>
            <input type="checkbox" bind:checked={normalize_ease} />
            {i18n("as-ratio")}
        </label>
        <div class="toggle">
            <label>
                <input type="checkbox" bind:checked={gradeSuccessOnly} />
                {i18n("success-only-hard-good-easy")}
            </label>
        </div>
        <p>{i18n("grade-distribution-by-repetitions-help")}</p>
    </RevlogGraphContainer>
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("grade-distribution-by-difficulty")}</h1>
        <BarScrollable
            slot="graph"
            data={easeBarChart(gradeByDifficultySeries, 0, normalize_ease, difficultyBucketLabeler)}
            average={normalize_ease}
            left_aligned
            bins={100}
            bind:binSize={difficultyBinSize}
        />
        <label>
            <input type="checkbox" bind:checked={normalize_ease} />
            {i18n("as-ratio")}
        </label>
        <div class="toggle">
            <label>
                <input type="checkbox" bind:checked={gradeSuccessOnly} />
                {i18n("success-only-hard-good-easy")}
            </label>
        </div>
        <p>{i18n("grade-distribution-by-difficulty-help")}</p>
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
