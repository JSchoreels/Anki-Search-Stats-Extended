<script lang="ts">
    import { onDestroy } from "svelte"
    import DailyPredictionGraph from "./DailyPredictionGraph.svelte"
    import ModelSelector from "./ModelSelector.svelte"
    import Warning from "./Warning.svelte"
    import type { CalibrationSamples } from "./calibrationSamples"
    import type { DailyModelSources } from "./dailyModelSources"
    import type { DailyPredictionMetric, DailyPredictionPoint } from "./dailyPredictionData"
    import { applyDailyActualRecall, type DailyActualRecall } from "./dailyRecallGap"
    import { FSRS_COMPARISON_COLOUR, RWKV_COMPARISON_COLOUR } from "./graph"
    import { i18n } from "./i18n"
    import {
        isRwkvModel,
        modelOptions,
        type ModelPredictionSources,
        type ModelPredictionStates,
    } from "./modelPredictionSources"
    import { revlogs, type FsrsCalibrationStats, type RwkvCalibrationStats } from "./stores"
    import type { StatsHistory } from "./statsHistory"
    import type { Tasks } from "./statsTasks"
    import { runStatsTask } from "./statsWorkerClient"

    export let samples: CalibrationSamples | null
    export let fsrs: FsrsCalibrationStats | null
    export let rwkv: RwkvCalibrationStats | null
    export let comparison: ReturnType<Tasks["comparison"]> | null
    export let modelPredictions: ModelPredictionSources
    export let dailyModels: DailyModelSources
    export let metric: DailyPredictionMetric

    type Source = {
        id: string
        label: string
        color: string
        dashed: boolean
        phase: "loading" | "ready" | "failed"
        predictions?: Float64Array | null
        precomputed?: DailyPredictionPoint[]
        warnings: string[]
        error?: string
        progress?: { phase: string; current?: number; total?: number }
    }

    let first = "fsrs"
    let second = "rwkv"
    let actual: DailyActualRecall | null = null
    let actualError = ""
    let actualHistory: StatsHistory | null | undefined
    let actualRequest: AbortController | undefined
    const owner = Symbol("daily-model-comparison")

    function loadActual(history: StatsHistory | null) {
        if (history === actualHistory) return
        actualHistory = history
        actualRequest?.abort()
        actualRequest = undefined
        actual = null
        actualError = ""
        if (!history) return
        const request = new AbortController()
        actualRequest = request
        void runStatsTask("dailyActualRecall", [history], request.signal).then(
            (result) => {
                if (!request.signal.aborted) actual = result
            },
            (error) => {
                if (!request.signal.aborted)
                    actualError = error instanceof Error ? error.message : String(error)
            }
        )
    }

    function source(
        model: string,
        index: number,
        variants: ModelPredictionStates,
        fsrs: FsrsCalibrationStats | null,
        rwkv: RwkvCalibrationStats | null,
        comparison: ReturnType<Tasks["comparison"]> | null,
        models: { id: string; label: string }[]
    ): Source {
        const label = models.find((item) => item.id === model)?.label ?? model
        const common = {
            id: model,
            label,
            color: index === 0 ? FSRS_COMPARISON_COLOUR : RWKV_COMPARISON_COLOUR,
            dashed: index === 1,
        }
        if (model === "fsrs")
            return {
                ...common,
                phase: fsrs ? "ready" : "loading",
                predictions: fsrs
                    ? fsrs.cachedPredictionCount > 0
                        ? fsrs.predictions
                        : null
                    : undefined,
                precomputed: comparison?.fsrsDaily,
                warnings: fsrs?.warnings ?? [],
            }
        if (model === "rwkv")
            return {
                ...common,
                phase: rwkv ? "ready" : "loading",
                predictions: rwkv?.predictions,
                precomputed: comparison?.rwkvDaily,
                warnings: rwkv?.warnings ?? [],
            }
        const state = isRwkvModel(model) ? variants[model] : undefined
        return {
            ...common,
            phase: state?.phase ?? "loading",
            predictions: state?.predictions,
            warnings: state?.warnings ?? [],
            error: state?.error,
            progress: state?.progress,
        }
    }

    function retry(item: Source & { dataPhase?: string }) {
        if (item.phase === "failed" && isRwkvModel(item.id)) modelPredictions.retry(item.id)
        else dailyModels.retry(item.id)
    }

    $: if (metric === "standardizedGap") loadActual($revlogs)
    $: models = modelOptions()
    $: variants = $modelPredictions
    $: selected = second === "none" ? [first] : [first, second]
    $: selectedVariants = [...new Set(selected.filter(isRwkvModel))]
    $: if (samples) selectedVariants.forEach((model) => modelPredictions.ensure(model))
    $: sources = selected.map((model, index) =>
        source(model, index, variants, fsrs, rwkv, comparison, models)
    )
    $: dailyModels.select(owner, selected)
    $: if (samples)
        sources.forEach((item) => {
            if (item.phase === "ready" && item.predictions !== undefined)
                dailyModels.ensure(item.id, item.predictions, item.precomputed)
        })
    $: daily = $dailyModels
    $: statuses = sources.map((item) => {
        const state = daily[item.id]
        const dataPhase = state?.predictions === item.predictions ? state?.phase : undefined
        return { ...item, dataPhase, dataError: state?.error }
    })
    $: uniqueStatuses = statuses.filter(
        (item, index) => statuses.findIndex((other) => other.id === item.id) === index
    )
    $: warnings = Array.from(new Set(sources.flatMap((item) => item.warnings)))
    $: available =
        metric !== "standardizedGap" || actual
            ? statuses.flatMap((item) => {
                  const state = daily[item.id]
                  return item.phase === "ready" && item.dataPhase === "ready" && state?.data
                      ? [
                            {
                                model: item.id,
                                label: item.label,
                                color: item.color,
                                dashed: item.dashed,
                                predictions: item.predictions ?? null,
                                data:
                                    metric === "standardizedGap"
                                        ? applyDailyActualRecall(state.data, actual!)
                                        : state.data,
                            },
                        ]
                      : []
              })
            : []
    $: pending =
        (metric === "standardizedGap" && !actual) ||
        statuses.some(
            (item) =>
                item.phase === "loading" ||
                (item.phase === "ready" && (!item.dataPhase || item.dataPhase === "loading"))
        )
    onDestroy(() => {
        actualRequest?.abort()
        dailyModels.release(owner)
    })
</script>

<ModelSelector {models} bind:first bind:second allowNone />
{#if warnings.length}
    <Warning always>{warnings.join(" ")}</Warning>
{/if}
{#if actualError}
    <p role="alert">{i18n("daily-prediction-recall-error", { error: actualError })}</p>
    <button
        type="button"
        on:click={() => {
            const history = actualHistory
            actualHistory = undefined
            loadActual(history ?? null)
        }}
    >
        {i18n("model-retry")}
    </button>
{/if}
{#each uniqueStatuses as item}
    {#if item.phase === "failed" || item.dataPhase === "failed"}
        <div class="calibration-message">
            {i18n("model-failed", { model: item.label, error: item.error ?? item.dataError ?? "" })}
        </div>
        <button type="button" on:click={() => retry(item)}>{i18n("model-retry")}</button>
    {:else if item.phase === "loading" && isRwkvModel(item.id)}
        <div class="calibration-message">
            {item.progress?.phase === "waiting"
                ? i18n("model-waiting", { model: item.label })
                : i18n("model-preparing", {
                      model: item.label,
                      current: item.progress?.current ?? 0,
                      total: item.progress?.total ?? 0,
                  })}
        </div>
    {:else if (item.phase === "loading" || item.dataPhase === "loading") && available.length}
        <small>{i18n("model-loading", { model: item.label })}</small>
    {/if}
{/each}
{#if available.length}
    <DailyPredictionGraph fsrs={[]} rwkv={[]} {metric} selectedSeries={available} />
{:else if pending && !actualError && !uniqueStatuses.some((item) => item.phase === "loading" && isRwkvModel(item.id))}
    <div class="calibration-message">{i18n("loading")}</div>
{/if}

<style>
    .calibration-message {
        display: flex;
        flex: 1;
        align-items: center;
        justify-content: center;
        color: var(--fg-faint);
        text-align: center;
    }
</style>
