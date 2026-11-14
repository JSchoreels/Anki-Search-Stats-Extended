<script lang="ts">
    import { onDestroy } from "svelte"
    import RevlogGraphContainer from "../RevlogGraphContainer.svelte"
    import BarScrollable from "../BarScrollable.svelte"
    import Bar from "../Bar.svelte"
    import CalibrationGraphContainer from "../CalibrationGraphContainer.svelte"
    import GraphCategory from "../GraphCategory.svelte"
    import Warning from "../Warning.svelte"
    import MemorisedBar from "../MemorisedBar.svelte"
    import MemorisedPerReview from "../MemorisedPerReview.svelte"
    import MemorisedGraphContainer from "../MemorisedGraphContainer.svelte"
    import MemorisedSourceControls from "../MemorisedSourceControls.svelte"
    import ModelCalibration from "../ModelCalibration.svelte"
    import ModelComparison from "../ModelComparison.svelte"
    import CurrentDisagreement from "../CurrentDisagreement.svelte"
    import WorkloadForecast from "../WorkloadForecast.svelte"
    import DailyModelComparison from "../DailyModelComparison.svelte"
    import DailyLineGraph from "../DailyLineGraph.svelte"
    import ForgettingCurve from "../ForgettingCurve.svelte"
    import TimeMachineScroll from "../TimeMachineScroll.svelte"
    import { i18n, i18n_bundle, i18n_pattern } from "../i18n"
    import { TREND_PERSISTENCE_KEYS } from "../trendPersistenceKeys"
    import { barStringLabeler, barHourLabeler, type BarChart } from "../bar"
    import {
        calibrationComparison,
        calibration_samples,
        card_data,
        cancelRwkvStabilityComputation,
        fsrsCalibrationGeneration,
        fsrsCalibrationStats,
        memorised_stats,
        rwkvCalibrationStats,
        rwkvStabilityStats,
        scroll,
        searchLimit,
        binSize,
        revlogStats,
        stabilityOverTimeMode,
    } from "../stores"
    import { today, day_ms, no_rollover_today } from "../revlogGraphs"
    import { FSRS_COMPARISON_COLOUR, RWKV_COMPARISON_COLOUR } from "../graph"
    import type { PieDatum } from "../pie"
    import _ from "lodash"
    import * as d3 from "d3"
    import type { DailyPredictionMetric } from "../dailyPredictionData"
    import { createModelPredictionSources } from "../modelPredictionSources"
    import { createDailyModelSources } from "../dailyModelSources"

    const dailyMetrics: DailyPredictionMetric[] = ["standardizedGap", "logLoss"]
    const modelPredictions = createModelPredictionSources()
    const dailyModels = createDailyModelSources()
    $: modelPredictions.setSamples($calibration_samples, $card_data)
    $: dailyModels.setSamples($calibration_samples)
    onDestroy(() => {
        modelPredictions.destroy()
        dailyModels.destroy()
    })

    $: truncated = $searchLimit !== 0
    $: realScroll = -Math.abs($scroll)

    enum Average {
        MEDIAN,
        MEAN,
    }

    let average_type = Average.MEDIAN
    let difficulty_average_type = Average.MEDIAN
    let granularity = 20

    const shareFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
    function youngMatureShares(ratio: number | undefined, hasCards: boolean, prefix: string) {
        if (typeof ratio !== "number" || !Number.isFinite(ratio) || !hasCards) return []
        return [
            `${prefix}${i18n("young")}: ${shareFormat.format(ratio * 100)}%`,
            `${prefix}${i18n("mature")}: ${shareFormat.format((1 - ratio) * 100)}%`,
        ]
    }
    function fsrsStabilityShares(day: number, prefix = "") {
        const stats = $memorised_stats
        return youngMatureShares(
            stats?.day_young_ratio_s90?.[day],
            !!(stats?.day_means?.[day] ?? 0),
            prefix
        )
    }
    function rwkvStabilityShares(day: number, prefix = "") {
        const stats = $rwkvStabilityStats
        return youngMatureShares(
            stats?.youngRatioDays[day],
            (stats?.cardCountDays[day] ?? 0) > 0,
            prefix
        )
    }
    function stabilityDetails(day: number) {
        if ($stabilityOverTimeMode === "rwkv") return rwkvStabilityShares(day)
        if ($stabilityOverTimeMode === "fsrs") return fsrsStabilityShares(day)
        return [
            ...fsrsStabilityShares(day, `${i18n("memorised-source-fsrs")} — `),
            ...rwkvStabilityShares(day, `${i18n("memorised-source-rwkv")} — `),
        ]
    }

    $: fsrsStability =
        (average_type == Average.MEAN
            ? $memorised_stats?.day_means
            : $memorised_stats?.day_medians) ?? []
    $: fsrsDifficulty =
        (difficulty_average_type == Average.MEAN
            ? $memorised_stats?.day_difficulty_means
            : $memorised_stats?.day_difficulty_medians) ?? []
    $: rwkvStability =
        (average_type == Average.MEAN
            ? $rwkvStabilityStats?.meanDays
            : $rwkvStabilityStats?.medianDays) ?? []
    $: rwkvStabilityPending =
        $stabilityOverTimeMode !== "fsrs" &&
        !$rwkvStabilityStats?.done &&
        !$rwkvStabilityStats?.error
    $: rwkvStabilityPercent = $rwkvStabilityStats?.total
        ? Math.min(100, Math.round((100 * $rwkvStabilityStats.current) / $rwkvStabilityStats.total))
        : 0

    let stability_time_machine_bar: BarChart
    $: stability_time_machine_bar = {
        row_colours: ["#70AFD6"],
        row_labels: [i18n("cards")],
        data: Array.from($memorised_stats?.stability_bins_days[today + realScroll] ?? []).map(
            (v, i) => ({
                values: [v ?? 0],
                label: i.toString(),
            })
        ),
        tick_spacing: 5,
        columnLabeler: barStringLabeler(i18n_bundle.getMessage("stability-of")?.value!),
    }

    $: difficulty_binner = d3
        .bin<[number, number], number>()
        .thresholds(granularity)
        .domain([0, 100])
        .value((a) => a[0])

    $: difficulty_bins = difficulty_binner([
        ...($memorised_stats?.difficulty_days[today + realScroll] ?? []).entries(),
    ])

    let difficulty_time_machine_bar: BarChart
    $: difficulty_time_machine_bar = {
        row_colours: ["red"],
        row_labels: [i18n("card-count")],
        data: Array.from(difficulty_bins).map((v, i) => ({
            values: [_.sumBy(v, (v) => v[1])],
            label: `${v?.[0]?.[0] / 10}`,
        })),
        tick_spacing: difficulty_bins.length / 5,
        barWidth: 10 / difficulty_bins.length + 1,
        columnLabeler: barStringLabeler(i18n_pattern("difficulty-of")),
    }

    function minIndex(vals: Record<number, any>) {
        return _.min(Object.keys(vals).map((k) => parseInt(k))) ?? 0
    }

    $: review_leftmost = minIndex($revlogStats?.intervals ?? {}) - today
    $: time_machine_min = review_leftmost
    // Comparisons and daily FSRS scores use held-out cached predictions, never replay.
    $: fsrsHeldOutGenerating =
        $fsrsCalibrationGeneration?.phase === "queued" ||
        $fsrsCalibrationGeneration?.phase === "running"
</script>

<GraphCategory hidden_title="FSRS" config_name="fsrs">
    <MemorisedGraphContainer graphId="fsrs:memorised">
        <h1 slot="title">{i18n("memorised")}</h1>
        <MemorisedBar slot="graph" burden={$revlogStats?.burden ?? []} />
        {#if truncated}
            <Warning>{i18n("memorised-truncated-warning")}</Warning>
        {/if}
        <p>
            {i18n("memorised-help")}
            <br />
            <br />
            {i18n("memorised-help2")}
        </p>
    </MemorisedGraphContainer>
    <MemorisedGraphContainer graphId="fsrs:memorised-per-review">
        <h1 slot="title">{i18n("memorised-per-review")}</h1>
        <MemorisedPerReview slot="graph" />
        {#if truncated}
            <Warning>{i18n("memorised-truncated-warning")}</Warning>
        {/if}
        <p>{i18n("memorised-per-review-help")}</p>
    </MemorisedGraphContainer>
    <CalibrationGraphContainer graphId="fsrs:calibration">
        <h1 slot="title">{i18n("model-calibration")}</h1>
        <div slot="graph" class="calibration-panel">
            <ModelCalibration
                samples={$calibration_samples}
                fsrs={$fsrsCalibrationStats}
                rwkv={$rwkvCalibrationStats}
                fallbackFsrsBins={$memorised_stats?.calibration ?? []}
                {modelPredictions}
            />
        </div>
        <p>
            {i18n("model-calibration-help")}
        </p>
    </CalibrationGraphContainer>
    <CalibrationGraphContainer graphId="fsrs:um-plus">
        <h1 slot="title">{i18n("um-plus")}</h1>
        <div slot="graph" class="calibration-panel">
            <ModelComparison
                kind="umPlus"
                samples={$calibration_samples}
                fsrs={$fsrsCalibrationStats}
                rwkv={$rwkvCalibrationStats}
                comparison={$calibrationComparison}
                fsrsGenerating={fsrsHeldOutGenerating}
                {modelPredictions}
            />
        </div>
        <ul class="um-plus-help">
            <li>{i18n("um-plus-help-error")}</li>
            <li>{i18n("um-plus-help-direction")}</li>
            <li>{i18n("um-plus-help-volume")}</li>
            <li>{i18n("um-plus-help-scores")}</li>
            <li>{i18n("um-plus-help-percentiles")}</li>
            <li>{i18n("um-plus-help-small-buckets")}</li>
            <li>{i18n("model-comparison-help-sources")}</li>
        </ul>
    </CalibrationGraphContainer>
    <CalibrationGraphContainer graphId="fsrs:roc">
        <h1 slot="title">{i18n("roc")}</h1>
        <div slot="graph" class="calibration-panel">
            <ModelComparison
                kind="roc"
                samples={$calibration_samples}
                fsrs={$fsrsCalibrationStats}
                rwkv={$rwkvCalibrationStats}
                comparison={$calibrationComparison}
                fsrsGenerating={fsrsHeldOutGenerating}
                {modelPredictions}
            />
        </div>
        <ul class="um-plus-help">
            <li>{i18n("roc-help-curve")}</li>
            <li>{i18n("roc-help-auc")}</li>
            <li>{i18n("roc-help-sample")}</li>
            <li>{i18n("model-comparison-help-sources")}</li>
        </ul>
    </CalibrationGraphContainer>
    <CurrentDisagreement />
    <WorkloadForecast />
    {#each dailyMetrics as metric}
        <CalibrationGraphContainer graphId={`fsrs:daily-${metric}`}>
            <h1 slot="title">{i18n(`daily-prediction-${metric}`)}</h1>
            <div slot="graph" class="calibration-panel">
                <DailyModelComparison
                    samples={$calibration_samples}
                    fsrs={$fsrsCalibrationStats}
                    rwkv={$rwkvCalibrationStats}
                    comparison={$calibrationComparison}
                    {modelPredictions}
                    {dailyModels}
                    {metric}
                />
            </div>
            <p>{i18n(`daily-prediction-${metric}-help`)}</p>
            <p>
                {i18n(
                    metric === "standardizedGap"
                        ? "daily-prediction-gap-sample-help"
                        : "daily-prediction-sample-help"
                )}
            </p>
        </CalibrationGraphContainer>
    {/each}
    <MemorisedGraphContainer graphId="fsrs:stability-time-machine">
        <h1 slot="title">{i18n("stability-time-machine")}</h1>
        <BarScrollable slot="graph" data={stability_time_machine_bar} left_aligned />
        <TimeMachineScroll min={time_machine_min} />
        <p>{i18n("stability-time-machine-help")}</p>
        {#if truncated}
            <Warning>{i18n("generic-truncated-warning")}</Warning>
        {/if}
    </MemorisedGraphContainer>
    <MemorisedGraphContainer graphId="fsrs:difficulty-time-machine">
        <h1 slot="title">{i18n("difficulty-time-machine")}</h1>
        <label class="scroll">
            {i18n("zoom")}
            <input type="range" bind:value={granularity} min={1} max={100} />
        </label>
        <Bar slot="graph" data={difficulty_time_machine_bar} />
        <label class="scroll">
            <span>
                {new Date(Date.now() + $scroll * day_ms).toLocaleDateString()}:
            </span>
            <TimeMachineScroll min={time_machine_min} />
        </label>
        <p>{i18n("difficulty-time-machine-help")}</p>
        {#if truncated}
            <Warning>{i18n("generic-truncated-warning")}</Warning>
        {/if}
    </MemorisedGraphContainer>
    <MemorisedGraphContainer graphId="fsrs:average-stability-over-time">
        <h1 slot="title">{i18n("average-stability-over-time")}</h1>
        <svelte:fragment slot="graph">
            <MemorisedSourceControls
                bind:mode={$stabilityOverTimeMode}
                showHistoryProgress={false}
            />
            {#if $stabilityOverTimeMode !== "fsrs" && $rwkvStabilityStats?.error}
                <Warning always>{$rwkvStabilityStats.error}</Warning>
            {:else if $stabilityOverTimeMode !== "fsrs" && $rwkvStabilityStats?.phase === "cancelled"}
                <Warning always>{i18n("stability-rwkv-cancelled")}</Warning>
            {:else if $stabilityOverTimeMode !== "fsrs" && $rwkvStabilityStats && !$rwkvStabilityStats.done}
                <div class="rwkv-progress">
                    <div>
                        {$rwkvStabilityStats.phase === "waiting"
                            ? i18n("stability-rwkv-waiting")
                            : $rwkvStabilityStats.phase === "loading"
                              ? i18n("loading")
                              : i18n("stability-rwkv-progress", {
                                    current: $rwkvStabilityStats.current,
                                    total: $rwkvStabilityStats.total,
                                    percent: rwkvStabilityPercent,
                                })}
                    </div>
                    <progress
                        max={$rwkvStabilityStats.total || 1}
                        value={$rwkvStabilityStats.current}
                        aria-label={i18n("stability-rwkv-progress-label")}
                    ></progress>
                    <button type="button" on:click={() => cancelRwkvStabilityComputation()}>
                        {i18n("cancel")}
                    </button>
                </div>
            {/if}
            <DailyLineGraph
                data={$stabilityOverTimeMode === "rwkv" ? rwkvStability : fsrsStability}
                label={i18n("stability-in-days")}
                seriesLabel={$stabilityOverTimeMode === "both"
                    ? i18n("memorised-source-fsrs")
                    : $stabilityOverTimeMode === "rwkv"
                      ? i18n("memorised-source-rwkv")
                      : undefined}
                color={$stabilityOverTimeMode === "rwkv"
                    ? RWKV_COMPARISON_COLOUR
                    : FSRS_COMPARISON_COLOUR}
                comparison={$stabilityOverTimeMode === "both"
                    ? {
                          data: rwkvStability,
                          label: i18n("memorised-source-rwkv"),
                          color: RWKV_COMPARISON_COLOUR,
                      }
                    : undefined}
                loading={rwkvStabilityPending}
                tooltipDetails={stabilityDetails}
                trendPersistenceKey={$stabilityOverTimeMode === "rwkv"
                    ? `${TREND_PERSISTENCE_KEYS.fsrs.averageStabilityOverTime}:rwkv`
                    : TREND_PERSISTENCE_KEYS.fsrs.averageStabilityOverTime}
                trendInfo={{ pattern: i18n_pattern("stability-per-day") }}
            />
        </svelte:fragment>
        <p>
            {i18n("average-stability-over-time-help")}
        </p>
        {#if $stabilityOverTimeMode !== "fsrs"}
            <p>{i18n("average-stability-over-time-rwkv-help")}</p>
        {/if}
        <div>
            <label>
                <input type="radio" value={Average.MEDIAN} bind:group={average_type} />
                {i18n("median")}
            </label>
            <label>
                <input type="radio" value={Average.MEAN} bind:group={average_type} />
                {i18n("mean")}
            </label>
        </div>
    </MemorisedGraphContainer>
    <MemorisedGraphContainer graphId="fsrs:average-difficulty-over-time">
        <h1 slot="title">{i18n("average-difficulty-over-time")}</h1>
        <DailyLineGraph
            slot="graph"
            data={fsrsDifficulty}
            label={i18n("difficulty")}
            trendPersistenceKey={TREND_PERSISTENCE_KEYS.fsrs.averageDifficultyOverTime}
            trendInfo={{ pattern: i18n_pattern("difficulty-per-day") }}
        />
        <p>{i18n("average-difficulty-over-time-help")}</p>
        <div>
            <label>
                <input type="radio" value={Average.MEDIAN} bind:group={difficulty_average_type} />
                {i18n("median")}
            </label>
            <label>
                <input type="radio" value={Average.MEAN} bind:group={difficulty_average_type} />
                {i18n("mean")}
            </label>
        </div>
        {#if truncated}
            <Warning>{i18n("generic-truncated-warning")}</Warning>
        {/if}
    </MemorisedGraphContainer>
</GraphCategory>

<style lang="scss">
    label.scroll {
        display: flex;
        align-items: center;
        gap: 0.5em;
    }

    .calibration-panel {
        display: flex;
        min-height: 16rem;
        flex-direction: column;
        gap: 0.5rem;
    }

    .um-plus-help {
        margin-top: 1em;
        font-size: small;
    }

    .rwkv-progress {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 0.35rem 0.75rem;
        align-items: center;
        margin: 0.5rem 0;
    }

    .rwkv-progress div {
        grid-column: 1 / -1;
    }

    .rwkv-progress progress {
        width: 100%;
    }
</style>
