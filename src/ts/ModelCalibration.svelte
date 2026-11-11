<script lang="ts">
    import FsrsCalibration from "./FSRSCalibration.svelte"
    import FsrsCalibrationStatus from "./FsrsCalibrationStatus.svelte"
    import ModelSelector from "./ModelSelector.svelte"
    import Warning from "./Warning.svelte"
    import type { CalibrationSamples } from "./calibrationSamples"
    import { FSRS_COMPARISON_COLOUR, RWKV_COMPARISON_COLOUR } from "./graph"
    import { i18n } from "./i18n"
    import type { LossBin } from "./MemorisedBar"
    import {
        isRwkvModel,
        modelOptions,
        type ModelPredictionSources,
        type ModelPredictionStates,
    } from "./modelPredictionSources"
    import type { FsrsCalibrationStats, RwkvCalibrationStats } from "./stores"

    export let samples: CalibrationSamples | null
    export let fsrs: FsrsCalibrationStats | null
    export let rwkv: RwkvCalibrationStats | null
    export let fallbackFsrsBins: LossBin[]
    export let modelPredictions: ModelPredictionSources

    let first = "fsrs"
    let second = "none"
    $: models = modelOptions()
    $: variants = $modelPredictions
    $: selected = second === "none" ? [first] : [first, second]
    $: selectedVariants = [...new Set(selected.filter(isRwkvModel))]
    $: if (samples) selectedVariants.forEach((model) => modelPredictions.ensure(model, true))
    $: sources = selected.map((model, index) =>
        source(model, index, fsrs, rwkv, fallbackFsrsBins, variants, models)
    )
    $: available = sources.filter((item) => item.phase === "ready")
    $: hasData = available.some((item) => item.bins.some((bin) => (bin?.count ?? 0) > 0))
    $: pending = sources.some((item) => item.phase === "loading")
    $: failed = sources.some((item) => item.phase === "failed")
    $: warnings = Array.from(new Set(sources.flatMap((item) => item.warnings)))

    function source(
        model: string,
        index: number,
        fsrs: FsrsCalibrationStats | null,
        rwkv: RwkvCalibrationStats | null,
        fallback: LossBin[],
        variants: ModelPredictionStates,
        models: { id: string; label: string }[]
    ) {
        const label = models.find((item) => item.id === model)?.label ?? model
        const color = index === 0 ? FSRS_COMPARISON_COLOUR : RWKV_COMPARISON_COLOUR
        if (model === "fsrs") {
            const cached = fsrs?.bins ?? []
            return {
                id: model,
                label,
                color,
                phase: fsrs ? "ready" : "loading",
                bins: cached.some((bin) => (bin?.count ?? 0) > 0) ? cached : fallback,
                warnings: fsrs?.warnings ?? [],
            }
        }
        if (model === "rwkv") {
            return {
                id: model,
                label,
                color,
                phase: rwkv ? "ready" : "loading",
                bins: rwkv?.bins ?? [],
                warnings: rwkv?.warnings ?? [],
            }
        }
        const state = isRwkvModel(model) ? variants[model] : undefined
        return {
            id: model,
            label,
            color,
            phase: state?.phase ?? "loading",
            bins: state?.bins ?? [],
            warnings: state?.warnings ?? [],
            error: state?.error,
            progress: state?.progress,
        }
    }

    function retry(model: string) {
        if (isRwkvModel(model)) modelPredictions.retry(model)
    }
</script>

<ModelSelector {models} bind:first bind:second allowNone />
{#if warnings.length > 0}
    <Warning always>{warnings.join(" ")}</Warning>
{/if}
{#each sources as item}
    {#if item.phase === "failed" && isRwkvModel(item.id)}
        <div class="calibration-message">
            {i18n("model-failed", { model: item.label, error: item.error ?? "" })}
        </div>
        <button type="button" on:click={() => retry(item.id)}>{i18n("model-retry")}</button>
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
    {:else if item.phase === "loading" && hasData}
        <small>{i18n("model-loading", { model: item.label })}</small>
    {/if}
{/each}
{#if hasData}
    <FsrsCalibration data={[]} series={available} />
{:else if pending && !sources.some((item) => item.phase === "loading" && isRwkvModel(item.id))}
    <div class="calibration-message">{i18n("loading")}</div>
{:else if !pending && !failed}
    <div class="calibration-message">{i18n("calibration-no-data")}</div>
{/if}
<FsrsCalibrationStatus />
