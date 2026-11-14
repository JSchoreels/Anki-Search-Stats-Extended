<script lang="ts">
    import { onDestroy } from "svelte"
    import GraphContainer from "./GraphContainer.svelte"
    import GraphSvg from "./GraphSvg.svelte"
    import CurrentRetrievability from "./CurrentRetrievability.svelte"
    import ModelSelector from "./ModelSelector.svelte"
    import { cids } from "./stores"
    import { i18n } from "./i18n"
    import { graphVisibility } from "./graphVisibility"
    import { getCurrentCardDisagreement, getCurrentFsrsModelPredictions } from "./search"
    import { isExplicitModel, modelOptions } from "./modelPredictionSources"
    import { createCurrentModelSources, type CurrentModelStates } from "./currentModelSources"
    import {
        buildCurrentDisagreementBins,
        pairCurrentModelScores,
        type CurrentDisagreementResponse,
        type CurrentModelScores,
        type CurrentScore,
        type CurrentSourceStatus,
    } from "./currentDisagreementData"
    import { renderCurrentDisagreementGraph } from "./CurrentDisagreementGraph"

    type Source = { phase: CurrentSourceStatus | "loading"; scores: CurrentScore[]; error?: string }

    let response: CurrentDisagreementResponse | null = null
    let fsrsScores: CurrentModelScores | null = null
    let fsrsLoading = false
    let fsrsController: AbortController | undefined
    let generation = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let first = "fsrs"
    let second = "rwkv"
    const currentModels = createCurrentModelSources()

    async function load(ids: number[], current: number) {
        try {
            const result = await getCurrentCardDisagreement(ids)
            if (current !== generation) return
            response = result
            if (result.status === "pending") timer = setTimeout(() => load(ids, current), 1000)
        } catch {
            if (current === generation)
                response = {
                    rows: [],
                    total: ids.length,
                    status: "failed",
                    rwkvStatus: "failed",
                    rwkvScores: [],
                }
        }
    }

    async function loadFsrs(ids: number[], current: number) {
        const controller = new AbortController()
        fsrsController = controller
        fsrsLoading = true
        try {
            const result = await getCurrentFsrsModelPredictions(ids, controller.signal)
            if (current === generation && !controller.signal.aborted) fsrsScores = result
        } catch {
            if (current === generation && !controller.signal.aborted)
                fsrsScores = { status: "failed", data: [] }
        } finally {
            if (fsrsController === controller) {
                fsrsController = undefined
                fsrsLoading = false
            }
        }
    }

    function restart(ids: number[] | null) {
        const current = ++generation
        clearTimeout(timer)
        fsrsController?.abort()
        fsrsController = undefined
        fsrsScores = null
        fsrsLoading = false
        response = null
        if (ids) void load(ids, current)
    }

    function source(
        model: string,
        current: CurrentDisagreementResponse | null,
        fsrs: CurrentModelScores | null,
        variants: CurrentModelStates
    ): Source {
        if (model === "fsrs")
            return fsrs
                ? { phase: fsrs.status, scores: fsrs.data }
                : { phase: "loading", scores: [] }
        if (model === "rwkv")
            return current
                ? { phase: current.rwkvStatus, scores: current.rwkvScores }
                : { phase: "loading", scores: [] }
        if (isExplicitModel(model)) {
            const state = variants[model]
            return state
                ? { phase: state.phase, scores: state.scores ?? [], error: state.error }
                : { phase: "loading", scores: [] }
        }
        return { phase: "unavailable", scores: [] }
    }

    function retryFailure(model: string) {
        if (isExplicitModel(model)) currentModels.retry(model)
        else if (model === "fsrs") fsrsScores = null
        else restart($cids)
    }

    const visible = graphVisibility("fsrs:current-disagreement", "fsrs:current-retrievability")
    const comparisonVisible = graphVisibility("fsrs:current-disagreement")
    $: restart($visible ? $cids : null)
    $: currentModels.setCards($comparisonVisible ? $cids : null)
    $: models = modelOptions()
    $: variants = $currentModels
    $: firstLabel = models.find((model) => model.id === first)?.label ?? first
    $: secondLabel = models.find((model) => model.id === second)?.label ?? second
    $: selectedVariants = [...new Set([first, second].filter(isExplicitModel))]
    $: currentModels.select($comparisonVisible && $cids ? selectedVariants : [])
    $: defaultPair =
        (first === "fsrs" && second === "rwkv") || (first === "rwkv" && second === "fsrs")
    $: needsFsrs = !defaultPair && (first === "fsrs" || second === "fsrs")
    $: if ($comparisonVisible && $cids && needsFsrs && !fsrsScores && !fsrsLoading)
        void loadFsrs($cids, generation)
    $: firstSource = source(first, response, fsrsScores, variants)
    $: secondSource = source(second, response, fsrsScores, variants)
    $: failure = defaultPair
        ? response && (response.status === "unavailable" || response.status === "failed")
            ? { model: "snapshot", phase: response.status }
            : null
        : ([
              { model: first, ...firstSource },
              { model: second, ...secondSource },
          ].find((item) => item.phase === "unavailable" || item.phase === "failed") ?? null)
    $: ready = defaultPair
        ? response?.status === "ready"
        : firstSource.phase === "ready" && secondSource.phase === "ready"
    $: pairs = defaultPair
        ? (response?.rows ?? []).map(({ cid, fsrs, rwkv }) => ({
              cid,
              first: first === "fsrs" ? fsrs : rwkv,
              second: first === "fsrs" ? rwkv : fsrs,
          }))
        : pairCurrentModelScores(firstSource.scores, secondSource.scores)
    $: bins = buildCurrentDisagreementBins(pairs)
    $: paired = bins.reduce((sum, bin) => sum + bin.cids.length, 0)
    $: missingFsrs6Parameters = selectedVariants.includes("fsrs6")
        ? (variants.fsrs6?.missingParameters ?? 0)
        : 0
    $: render = (svg: SVGElement) =>
        renderCurrentDisagreementGraph(svg, bins, firstLabel, secondLabel)
    onDestroy(() => {
        generation++
        clearTimeout(timer)
        fsrsController?.abort()
        currentModels.destroy()
    })
</script>

<GraphContainer graphId="fsrs:current-disagreement">
    <h1>{i18n("current-disagreement")}</h1>
    <ModelSelector {models} bind:first bind:second />
    {#if missingFsrs6Parameters && variants.fsrs6?.phase === "ready"}
        <p>{i18n("model-fsrs6-missing-parameters", { count: missingFsrs6Parameters })}</p>
    {/if}
    {#if failure}
        <p>
            {failure.model === "fsrs6" && failure.phase === "unavailable" && !failure.error
                ? i18n("model-fsrs6-unavailable")
                : isExplicitModel(failure.model)
                  ? i18n("model-failed", {
                        model:
                            models.find((item) => item.id === failure.model)?.label ??
                            failure.model,
                        error: variants[failure.model]?.error ?? "",
                    })
                  : failure.model === "fsrs"
                    ? i18n(`model-current-fsrs-${failure.phase}`)
                    : i18n(`current-disagreement-${failure.phase}`)}
        </p>
        <button on:click={() => retryFailure(failure.model)}>{i18n("model-retry")}</button>
    {:else if !ready}
        {#each selectedVariants as model}
            {#if variants[model]?.phase === "loading"}
                {@const progress = variants[model]?.progress}
                {@const label = models.find((item) => item.id === model)?.label ?? model}
                <p>
                    {progress?.phase === "replaying"
                        ? i18n("model-preparing", {
                              model: label,
                              current: progress.current ?? 0,
                              total: progress.total ?? 0,
                          })
                        : progress?.phase === "scoring"
                          ? i18n("model-current-scoring", {
                                model: label,
                                current: progress.current ?? 0,
                                total: progress.total ?? 0,
                            })
                          : i18n(model === "fsrs6" ? "model-loading" : "model-waiting", {
                                model: label,
                            })}
                </p>
            {/if}
        {/each}
        {#if selectedVariants.length === 0 || !selectedVariants.some((model) => variants[model]?.phase === "loading")}
            <p>{i18n("loading")}</p>
        {/if}
    {:else if paired}
        <GraphSvg {render} />
    {:else}
        <p>{i18n("current-disagreement-no-data")}</p>
    {/if}
    {#if ready}
        <p>{i18n("current-disagreement-count", { count: paired, total: $cids?.length ?? 0 })}</p>
    {/if}
    <p>{i18n("current-disagreement-help", { first: firstLabel, second: secondLabel })}</p>
</GraphContainer>

<CurrentRetrievability {response} retry={() => restart($cids)} />
