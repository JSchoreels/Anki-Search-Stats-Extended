<script lang="ts">
    import { onDestroy } from "svelte"
    import UMPlus from "./UMPlus.svelte"
    import UMPlusModelSelector from "./UMPlusModelSelector.svelte"
    import Warning from "./Warning.svelte"
    import { heldOutFsrsPredictions, type CalibrationSamples } from "./calibrationSamples"
    import { i18n } from "./i18n"
    import { latestResult } from "./latestResult"
    import {
        getRwkvUmPlusModelPages,
        type RwkvUmPlusModel,
        type RwkvUmPlusProgress,
    } from "./search"
    import type { FsrsCalibrationStats, RwkvCalibrationStats } from "./stores"
    import type { Tasks } from "./statsTasks"
    import { runStatsTask } from "./statsWorkerClient"
    import type { UmPlusData } from "./umPlusData"

    export let samples: CalibrationSamples | null
    export let fsrs: FsrsCalibrationStats | null
    export let rwkv: RwkvCalibrationStats | null
    export let comparison: ReturnType<Tasks["comparison"]> | null
    export let fsrsGenerating: boolean

    let first = "fsrs"
    let second = "rwkv"
    let data: UmPlusData | null = null
    let inputs: unknown[] | undefined
    let cancel: (() => void) | undefined
    type VariantState = {
        phase: "loading" | "ready" | "failed"
        progress?: RwkvUmPlusProgress
        predictions?: Float64Array
        warnings?: string[]
        error?: string
    }
    let variants: Partial<Record<RwkvUmPlusModel, VariantState>> = {}
    let sourceSamples: CalibrationSamples | null = null
    let sourceController = new AbortController()
    $: models = [
        { id: "fsrs", label: i18n("calibration-source-fsrs") },
        { id: "rwkv", label: i18n("um-plus-model-rwkv-current") },
        { id: "rwkv-big", label: i18n("um-plus-model-rwkv-big") },
        { id: "rwkv-small-curve", label: i18n("um-plus-model-rwkv-small-curve") },
        { id: "rwkv-small-instant", label: i18n("um-plus-model-rwkv-small-instant") },
        { id: "rwkv-tiny-instant", label: i18n("um-plus-model-rwkv-tiny-instant") },
    ]
    $: firstLabel = models.find((model) => model.id === first)?.label ?? first
    $: secondLabel = models.find((model) => model.id === second)?.label ?? second
    $: usesFsrs = first === "fsrs" || second === "fsrs"
    $: usesRwkv = first === "rwkv" || second === "rwkv"
    $: selectedVariants = [...new Set([first, second].filter(isVariant))]
    $: ensureVariants(samples, first, second)
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
    $: calculate(samples, first, second, fsrs, rwkv, comparison, fsrsGenerating, variants)

    function isVariant(model: string): model is RwkvUmPlusModel {
        return (
            model === "rwkv-big" ||
            model === "rwkv-small-curve" ||
            model === "rwkv-small-instant" ||
            model === "rwkv-tiny-instant"
        )
    }

    function ensureVariants(samples: CalibrationSamples | null, first: string, second: string) {
        if (sourceSamples !== samples) {
            sourceController.abort()
            sourceController = new AbortController()
            sourceSamples = samples
            variants = {}
        }
        if (!samples) return
        for (const model of new Set([first, second].filter(isVariant))) {
            if (variants[model]) continue
            if (samples.revlogIds.length === 0) {
                variants = {
                    ...variants,
                    [model]: { phase: "ready", predictions: new Float64Array(0) },
                }
                continue
            }
            variants = { ...variants, [model]: { phase: "loading" } }
            void loadVariant(model, samples, sourceController.signal)
        }
    }

    async function loadVariant(
        model: RwkvUmPlusModel,
        samples: CalibrationSamples,
        signal: AbortSignal
    ) {
        try {
            const pages = await getRwkvUmPlusModelPages(
                model,
                samples.revlogIds,
                signal,
                (progress) => {
                    if (!signal.aborted)
                        variants = { ...variants, [model]: { phase: "loading", progress } }
                }
            )
            const parsed = await runStatsTask("calibrationPredictions", [samples, pages], signal)
            if (!signal.aborted)
                variants = {
                    ...variants,
                    [model]: {
                        phase: "ready",
                        predictions: parsed.predictions,
                        warnings: parsed.warnings,
                    },
                }
        } catch (error) {
            if (!signal.aborted)
                variants = {
                    ...variants,
                    [model]: {
                        phase: "failed",
                        error: error instanceof Error ? error.message : String(error),
                    },
                }
        }
    }

    function retryVariant(model: RwkvUmPlusModel) {
        const next = { ...variants }
        delete next[model]
        variants = next
        ensureVariants(samples, first, second)
    }

    function calculate(
        samples: CalibrationSamples | null,
        first: string,
        second: string,
        fsrs: FsrsCalibrationStats | null,
        rwkv: RwkvCalibrationStats | null,
        comparison: ReturnType<Tasks["comparison"]> | null,
        generating: boolean,
        variants: Partial<Record<RwkvUmPlusModel, VariantState>>
    ) {
        const next = [
            samples,
            first,
            second,
            fsrs?.predictions,
            fsrs?.cachedPredictionCount,
            rwkv?.predictions,
            comparison,
            generating,
            isVariant(first) ? variants[first]?.predictions : null,
            isVariant(second) ? variants[second]?.predictions : null,
        ]
        if (inputs && next.every((value, index) => value === inputs![index])) return
        inputs = next
        cancel?.()
        cancel = undefined
        data = null
        if (!samples) return
        if (first === "fsrs" && second === "rwkv") {
            data = comparison?.umPlus ?? null
            return
        }
        const fsrsPredictions = fsrs && heldOutFsrsPredictions(fsrs)
        const source = (model: string) =>
            model === "fsrs"
                ? fsrsPredictions
                : model === "rwkv"
                  ? rwkv?.predictions
                  : isVariant(model)
                    ? variants[model]?.predictions
                    : undefined
        const firstPredictions = source(first)
        const secondPredictions = source(second)
        if (!firstPredictions || !secondPredictions) return
        cancel = latestResult(
            (result) => (data = result),
            (signal) =>
                runStatsTask("umPlus", [samples, firstPredictions, secondPredictions], signal)
        )
    }

    onDestroy(() => {
        cancel?.()
        sourceController.abort()
    })
</script>

<UMPlusModelSelector {models} bind:first bind:second />
{#if warnings.length > 0}
    <Warning always>{warnings.join(" ")}</Warning>
{/if}
{#if variantError}
    <div class="calibration-message">
        {i18n("um-plus-model-failed", {
            model: models.find((model) => model.id === variantError)?.label ?? variantError,
            error: variants[variantError]?.error ?? "",
        })}
    </div>
    <button type="button" on:click={() => retryVariant(variantError)}>
        {i18n("um-plus-retry")}
    </button>
{:else if variantPending}
    {#each selectedVariants as model}
        {#if variants[model]?.phase === "loading"}
            {@const progress = variants[model]?.progress}
            {@const label = models.find((item) => item.id === model)?.label ?? model}
            <div class="calibration-message">
                {progress?.phase === "waiting"
                    ? i18n("um-plus-model-waiting", { model: label })
                    : i18n("um-plus-preparing-model", {
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
    <div class="calibration-message">{i18n("um-plus-fsrs-held-out-unavailable")}</div>
{:else if !data}
    <div class="calibration-message">{i18n("loading")}</div>
{:else if data.count > 0}
    <UMPlus {data} firstModel={firstLabel} secondModel={secondLabel} />
{:else}
    <div class="calibration-message">{i18n("um-plus-no-data")}</div>
{/if}
