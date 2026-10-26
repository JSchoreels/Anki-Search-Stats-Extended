<script lang="ts">
    import RevlogGraphContainer from "../RevlogGraphContainer.svelte"
    import BarScrollable from "../BarScrollable.svelte"
    import Bar from "../Bar.svelte"
    import CalibrationGraphContainer from "../CalibrationGraphContainer.svelte"
    import GraphCategory from "../GraphCategory.svelte"
    import Warning from "../Warning.svelte"
    import MemorisedBar from "../MemorisedBar.svelte"
    import MemorisedPerReview from "../MemorisedPerReview.svelte"
    import MemorisedGraphContainer from "../MemorisedGraphContainer.svelte"
    import FsrsCalibration from "../FSRSCalibration.svelte"
    import FsrsCalibrationStatus from "../FsrsCalibrationStatus.svelte"
    import UMPlus from "../UMPlus.svelte"
    import ROC from "../ROC.svelte"
    import CurrentDisagreement from "../CurrentDisagreement.svelte"
    import DailyPredictionGraph from "../DailyPredictionGraph.svelte"
    import ForgettingCurve from "../ForgettingCurve.svelte"
    import TimeMachineScroll from "../TimeMachineScroll.svelte"
    import { i18n, i18n_bundle, i18n_pattern } from "../i18n"
    import { TREND_PERSISTENCE_KEYS } from "../trendPersistenceKeys"
    import { barDateLabeler, barStringLabeler, barHourLabeler, type BarChart } from "../bar"
    import {
        calibrationMode,
        calibrationComparison,
        fsrsCalibrationGeneration,
        fsrsCalibrationStats,
        memorised_stats,
        rwkvCalibrationStats,
        scroll,
        searchLimit,
        binSize,
        revlogStats,
    } from "../stores"
    import { today, day_ms, no_rollover_today } from "../revlogGraphs"
    import {
        FSRS_COMPARISON_COLOUR,
        MATURE_COLOUR,
        RWKV_COMPARISON_COLOUR,
        YOUNG_COLOUR,
    } from "../graph"
    import type { PieDatum } from "../pie"
    import _ from "lodash"
    import * as d3 from "d3"
    import type { DailyPredictionMetric } from "../dailyPredictionData"

    const dailyMetrics: DailyPredictionMetric[] = ["standardizedGap", "logLoss"]

    $: truncated = $searchLimit !== 0
    $: realScroll = -Math.abs($scroll)

    enum Average {
        MEDIAN,
        MEAN,
    }

    let average_type = Average.MEDIAN
    let interval_bin_size = 1
    let granularity = 20

    function barLabel(i: number) {
        return (i - today).toString()
    }

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
    $: cachedFsrsCalibrationData = $fsrsCalibrationStats?.bins ?? []
    $: fsrsCalibrationData =
        _.sumBy(cachedFsrsCalibrationData, (bin) => bin?.count ?? 0) > 0
            ? cachedFsrsCalibrationData
            : ($memorised_stats?.calibration ?? [])
    $: rwkvCalibrationData = $rwkvCalibrationStats?.bins ?? []
    $: calibrationData = $calibrationMode === "rwkv" ? rwkvCalibrationData : fsrsCalibrationData
    $: fsrsPending = !$fsrsCalibrationStats
    $: rwkvPending = !$rwkvCalibrationStats
    $: calibrationSeries =
        $calibrationMode === "both"
            ? [
                  {
                      label: i18n("calibration-legend-fsrs"),
                      bins: fsrsCalibrationData,
                      color: FSRS_COMPARISON_COLOUR,
                  },
                  {
                      label: i18n("calibration-legend-rwkv"),
                      bins: rwkvCalibrationData,
                      color: RWKV_COMPARISON_COLOUR,
                  },
              ].filter((_, i) => !(i === 0 ? fsrsPending : rwkvPending))
            : $calibrationMode === "rwkv"
              ? [
                    {
                        label: i18n("calibration-legend-rwkv"),
                        bins: rwkvCalibrationData,
                        color: RWKV_COMPARISON_COLOUR,
                    },
                ]
              : undefined
    $: calibrationPending =
        $calibrationMode === "both"
            ? fsrsPending || rwkvPending
            : $calibrationMode === "rwkv"
              ? rwkvPending
              : fsrsPending
    $: calibrationLoading =
        $calibrationMode === "both"
            ? fsrsPending && rwkvPending
            : $calibrationMode === "rwkv"
              ? rwkvPending
              : fsrsPending
    $: calibrationCount = _.sumBy(
        calibrationSeries?.flatMap((series) => series.bins) ?? calibrationData,
        (bin) => bin?.count ?? 0
    )
    $: calibrationWarnings =
        $calibrationMode === "both"
            ? [
                  ...($fsrsCalibrationStats?.warnings ?? []),
                  ...($rwkvCalibrationStats?.warnings ?? []),
              ]
            : $calibrationMode === "rwkv"
              ? ($rwkvCalibrationStats?.warnings ?? [])
              : ($fsrsCalibrationStats?.warnings ?? [])
    $: umPlusData = $calibrationComparison?.umPlus
    $: rocData = $calibrationComparison?.roc
    // Comparisons and daily FSRS scores use held-out cached predictions, never replay.
    $: fsrsHeldOutMissing =
        !!$fsrsCalibrationStats &&
        $fsrsCalibrationStats.cachedPredictionCount === 0 &&
        $fsrsCalibrationStats.predictions.length > 0
    $: fsrsHeldOutGenerating =
        $fsrsCalibrationGeneration?.phase === "queued" ||
        $fsrsCalibrationGeneration?.phase === "running"
    $: umPlusLoading =
        $calibrationComparison === null || (fsrsHeldOutMissing && fsrsHeldOutGenerating)
    $: umPlusWarnings = Array.from(
        new Set([
            ...($fsrsCalibrationStats?.warnings ?? []),
            ...($rwkvCalibrationStats?.warnings ?? []),
        ])
    )
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
        <h1 slot="title">
            {i18n(
                $calibrationMode === "rwkv"
                    ? "rwkv-calibration"
                    : $calibrationMode === "both"
                      ? "combined-calibration"
                      : "fsrs-calibration"
            )}
        </h1>
        <div slot="graph" class="calibration-panel">
            <div class="calibration-mode" role="group" aria-label={i18n("calibration-source")}>
                <label>
                    <input type="radio" value="fsrs" bind:group={$calibrationMode} />
                    {i18n("calibration-source-fsrs")}
                </label>
                <label>
                    <input type="radio" value="rwkv" bind:group={$calibrationMode} />
                    {i18n("calibration-source-rwkv")}
                </label>
                <label>
                    <input type="radio" value="both" bind:group={$calibrationMode} />
                    {i18n("calibration-source-both")}
                </label>
            </div>
            {#if calibrationWarnings.length > 0}
                <Warning always>{calibrationWarnings.join(" ")}</Warning>
            {/if}
            {#if calibrationLoading}
                <div class="calibration-message">{i18n("loading")}</div>
            {:else if calibrationCount > 0}
                <FsrsCalibration data={calibrationData} series={calibrationSeries} />
            {:else if !calibrationPending}
                <div class="calibration-message">
                    {i18n(
                        $calibrationMode === "rwkv" || $calibrationMode === "both"
                            ? "rwkv-calibration-no-data"
                            : "calibration-no-data"
                    )}
                </div>
            {/if}
            {#if $calibrationMode === "both" && !calibrationLoading}
                {#if fsrsPending}<small>
                        {i18n("calibration-legend-fsrs")}: {i18n("loading")}
                    </small>{/if}
                {#if rwkvPending}<small>
                        {i18n("calibration-legend-rwkv")}: {i18n("loading")}
                    </small>{/if}
            {/if}
            <FsrsCalibrationStatus />
        </div>
        <p>
            {i18n("fsrs-calibration-help")}
        </p>
    </CalibrationGraphContainer>
    <CalibrationGraphContainer graphId="fsrs:um-plus">
        <h1 slot="title">{i18n("um-plus")}</h1>
        <div slot="graph" class="calibration-panel">
            {#if umPlusWarnings.length > 0}
                <Warning always>{umPlusWarnings.join(" ")}</Warning>
            {/if}
            {#if umPlusLoading}
                <div class="calibration-message">{i18n("loading")}</div>
            {:else if fsrsHeldOutMissing}
                <div class="calibration-message">
                    {i18n("comparison-fsrs-held-out-unavailable")}
                </div>
            {:else if umPlusData && umPlusData.count > 0}
                <UMPlus data={umPlusData} />
            {:else}
                <div class="calibration-message">{i18n("um-plus-no-data")}</div>
            {/if}
        </div>
        <ul class="um-plus-help">
            <li>{i18n("um-plus-help-error")}</li>
            <li>{i18n("um-plus-help-direction")}</li>
            <li>{i18n("um-plus-help-volume")}</li>
            <li>{i18n("um-plus-help-scores")}</li>
            <li>{i18n("um-plus-help-percentiles")}</li>
            <li>{i18n("um-plus-help-small-buckets")}</li>
        </ul>
    </CalibrationGraphContainer>
    <CalibrationGraphContainer graphId="fsrs:roc">
        <h1 slot="title">{i18n("roc")}</h1>
        <div slot="graph" class="calibration-panel">
            {#if umPlusWarnings.length > 0}
                <Warning always>{umPlusWarnings.join(" ")}</Warning>
            {/if}
            {#if umPlusLoading}
                <div class="calibration-message">{i18n("loading")}</div>
            {:else if fsrsHeldOutMissing}
                <div class="calibration-message">
                    {i18n("comparison-fsrs-held-out-unavailable")}
                </div>
            {:else if rocData && rocData.positiveCount > 0 && rocData.negativeCount > 0}
                <ROC data={rocData} />
            {:else}
                <div class="calibration-message">{i18n("roc-no-data")}</div>
            {/if}
        </div>
        <ul class="um-plus-help">
            <li>{i18n("roc-help-curve")}</li>
            <li>{i18n("roc-help-auc")}</li>
            <li>{i18n("roc-help-sample")}</li>
        </ul>
    </CalibrationGraphContainer>
    <CurrentDisagreement />
    {#each dailyMetrics as metric}
        <CalibrationGraphContainer graphId={`fsrs:daily-${metric}`}>
            <h1 slot="title">{i18n(`daily-prediction-${metric}`)}</h1>
            <div slot="graph" class="calibration-panel">
                {#if umPlusWarnings.length}
                    <Warning always>{umPlusWarnings.join(" ")}</Warning>
                {/if}
                {#if $calibrationComparison === null}
                    <div class="calibration-message">{i18n("loading")}</div>
                {:else}
                    <DailyPredictionGraph
                        fsrs={$calibrationComparison.fsrsDaily}
                        rwkv={$calibrationComparison.rwkvDaily}
                        {metric}
                    />
                {/if}
            </div>
            <p>{i18n(`daily-prediction-${metric}-help`)}</p>
            <p>{i18n("daily-prediction-sample-help")}</p>
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
        <BarScrollable
            slot="graph"
            bind:binSize={interval_bin_size}
            data={{
                row_colours: [YOUNG_COLOUR, MATURE_COLOUR],
                row_labels: [i18n("young"), i18n("mature")],
                data: (average_type == Average.MEAN
                    ? $memorised_stats!.day_means
                    : $memorised_stats!.day_medians
                ).map((day, i) => {
                    const young_ratio = $memorised_stats!.day_young_ratio_s90?.[i] ?? 0
                    return {
                        values: [day * young_ratio, day * (1 - young_ratio)],
                        label: barLabel(i),
                    }
                }),
                columnLabeler: barDateLabeler,
            }}
            average
            trend
            trend_date_axis
            trendPersistenceKey={TREND_PERSISTENCE_KEYS.fsrs.averageStabilityOverTime}
            trend_info={{ pattern: i18n_pattern("stability-per-day") }}
        />
        <p>
            {i18n("average-stability-over-time-help")}
        </p>
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

    .calibration-mode {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
    }

    .calibration-message {
        display: flex;
        flex: 1;
        align-items: center;
        justify-content: center;
        color: var(--fg-faint);
        text-align: center;
    }

    .um-plus-help {
        margin-top: 1em;
        font-size: small;
    }
</style>
