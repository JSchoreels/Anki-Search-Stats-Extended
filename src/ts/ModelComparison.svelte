<script lang="ts">
    import { onDestroy } from "svelte"
    import UMPlus from "./UMPlus.svelte"
    import ROC from "./ROC.svelte"
    import ModelSelector from "./ModelSelector.svelte"
    import Warning from "./Warning.svelte"
    import { heldOutFsrsPredictions, type CalibrationSamples } from "./calibrationSamples"
    import { i18n } from "./i18n"
    import { latestResult } from "./latestResult"
    import {
        isRwkvModel,
        modelOptions,
        type ModelPredictionSources,
        type ModelPredictionStates,
    } from "./modelPredictionSources"
    import type { FsrsCalibrationStats, RwkvCalibrationStats } from "./stores"
    import type { Tasks } from "./statsTasks"
    import { runStatsTask } from "./statsWorkerClient"
    import type { RocData } from "./rocData"
    import type { UmPlusData } from "./umPlusData"

    export let kind: "umPlus" | "roc"
    export let samples: CalibrationSamples | null
    export let fsrs: FsrsCalibrationStats | null
    export let rwkv: RwkvCalibrationStats | null
    export let comparison: ReturnType<Tasks["comparison"]> | null
    export let fsrsGenerating: boolean
    export let modelPredictions: ModelPredictionSources

    let first = "fsrs"
    let second = "rwkv"
    let umPlusData: UmPlusData | null = null
    let rocData: RocData | null = null
    let inputs: unknown[] | undefined
    let cancel: (() => void) | undefined
    $: models = modelOptions()
    $: variants = $modelPredictions
    $: firstLabel = models.find((model) => model.id === first)?.label ?? first
    $: secondLabel = models.find((model) => model.id === second)?.label ?? second
    $: usesFsrs = first === "fsrs" || second === "fsrs"
    $: usesRwkv = first === "rwkv" || second === "rwkv"
    $: selectedVariants = [...new Set([first, second].filter(isRwkvModel))]
    $: if (samples) selectedVariants.forEach((model) => modelPredictions.ensure(model))
    $: variantPending = selectedVariants.some((model) => variants[model]?.phase !== "ready")
    $: variantError = selectedVariants.find((model) => variants[model]?.phase === "failed")
    $: missingFsrs = !!fsrs && fsrs.cachedPredictionCount === 0 && fsrs.predictions.length > 0
    $: missingSource = (usesFsrs && !fsrs) || (usesRwkv && !rwkv)
    $: warnings = Array.from(
        new Set([
            ...(usesFsrs ? (fsrs?.warnings ?? []) : []),
            ...(usesRwkv ? (rwkv?.warnings ?? []) : []),
            ...selectedVariants.flatMap((model) => variants[model]?.warnings ?? []),
        ])
    )
    $: calculate(kind, samples, first, second, fsrs, rwkv, comparison, fsrsGenerating, variants)

    function calculate(
        kind: "umPlus" | "roc",
        samples: CalibrationSamples | null,
        first: string,
        second: string,
        fsrs: FsrsCalibrationStats | null,
        rwkv: RwkvCalibrationStats | null,
        comparison: ReturnType<Tasks["comparison"]> | null,
        generating: boolean,
        variants: ModelPredictionStates
    ) {
        const next = [
            kind,
            samples,
            first,
            second,
            fsrs?.predictions,
            fsrs?.cachedPredictionCount,
            rwkv?.predictions,
            comparison,
            generating,
            isRwkvModel(first) ? variants[first]?.predictions : null,
            isRwkvModel(second) ? variants[second]?.predictions : null,
        ]
        if (inputs && next.every((value, index) => value === inputs![index])) return
        inputs = next
        cancel?.()
        cancel = undefined
        umPlusData = null
        rocData = null
        if (!samples) return
        if (first === "fsrs" && second === "rwkv") {
            if (kind === "umPlus") umPlusData = comparison?.umPlus ?? null
            else rocData = comparison?.roc ?? null
            return
        }
        if (
            (first === "fsrs" || second === "fsrs") &&
            fsrs &&
            fsrs.cachedPredictionCount === 0 &&
            fsrs.predictions.length > 0
        )
            return
        const fsrsPredictions = fsrs && heldOutFsrsPredictions(fsrs)
        const source = (model: string) =>
            model === "fsrs"
                ? fsrsPredictions
                : model === "rwkv"
                  ? rwkv?.predictions
                  : isRwkvModel(model)
                    ? variants[model]?.predictions
                    : undefined
        const firstPredictions = source(first)
        const secondPredictions = source(second)
        if (!firstPredictions || !secondPredictions) return
        if (kind === "umPlus") {
            cancel = latestResult(
                (result) => (umPlusData = result),
                (signal) =>
                    runStatsTask("umPlus", [samples, firstPredictions, secondPredictions], signal)
            )
        } else {
            cancel = latestResult(
                (result) => (rocData = result),
                (signal) =>
                    runStatsTask("roc", [samples, firstPredictions, secondPredictions], signal)
            )
        }
    }

    onDestroy(() => cancel?.())
</script>

<ModelSelector {models} bind:first bind:second />
{#if warnings.length > 0}
    <Warning always>{warnings.join(" ")}</Warning>
{/if}
{#if variantError}
    <div class="calibration-message">
        {i18n("model-failed", {
            model: models.find((model) => model.id === variantError)?.label ?? variantError,
            error: variants[variantError]?.error ?? "",
        })}
    </div>
    <button type="button" on:click={() => modelPredictions.retry(variantError)}>
        {i18n("model-retry")}
    </button>
{:else if variantPending}
    {#each selectedVariants as model}
        {#if variants[model]?.phase === "loading"}
            {@const progress = variants[model]?.progress}
            {@const label = models.find((item) => item.id === model)?.label ?? model}
            <div class="calibration-message">
                {progress?.phase === "waiting"
                    ? i18n("model-waiting", { model: label })
                    : i18n("model-preparing", {
                          model: label,
                          current: progress?.current ?? 0,
                          total: progress?.total ?? 0,
                      })}
            </div>
        {/if}
    {/each}
{:else if missingSource || (usesFsrs && missingFsrs && fsrsGenerating)}
    <div class="calibration-message">{i18n("loading")}</div>
{:else if usesFsrs && missingFsrs}
    <div class="calibration-message">{i18n("model-fsrs-held-out-unavailable")}</div>
{:else if (kind === "umPlus" && !umPlusData) || (kind === "roc" && !rocData)}
    <div class="calibration-message">{i18n("loading")}</div>
{:else if kind === "umPlus" && umPlusData && umPlusData.count > 0}
    <UMPlus data={umPlusData} firstModel={firstLabel} secondModel={secondLabel} />
{:else if kind === "roc" && rocData && rocData.positiveCount > 0 && rocData.negativeCount > 0}
    <ROC data={rocData} firstModel={firstLabel} secondModel={secondLabel} />
{:else}
    <div class="calibration-message">
        {i18n(kind === "umPlus" ? "um-plus-no-data" : "roc-no-data")}
    </div>
{/if}
