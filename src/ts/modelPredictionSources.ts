import { writable } from "svelte/store"
import type { CalibrationSamples } from "./calibrationSamples"
import { i18n } from "./i18n"
import { withConfidenceIntervals, type LossBin } from "./MemorisedBar"
import { getRwkvUmPlusModelPages, type RwkvUmPlusModel, type RwkvUmPlusProgress } from "./search"
import { runStatsTask } from "./statsWorkerClient"

export type ModelPredictionState = {
    phase: "loading" | "ready" | "failed"
    progress?: RwkvUmPlusProgress
    predictions?: Float64Array
    bins?: LossBin[]
    warnings?: string[]
    error?: string
    bandsPending?: boolean
    bandsReady?: boolean
}
export type ModelPredictionStates = Partial<Record<RwkvUmPlusModel, ModelPredictionState>>

export function isRwkvModel(model: string): model is RwkvUmPlusModel {
    return (
        model === "rwkv-big" ||
        model === "rwkv-small-curve" ||
        model === "rwkv-small-instant" ||
        model === "rwkv-tiny-instant"
    )
}

export function modelOptions() {
    return [
        { id: "fsrs", label: i18n("calibration-source-fsrs") },
        { id: "rwkv", label: i18n("model-rwkv-current") },
        { id: "rwkv-big", label: i18n("model-rwkv-big") },
        { id: "rwkv-small-curve", label: i18n("model-rwkv-small-curve") },
        { id: "rwkv-small-instant", label: i18n("model-rwkv-small-instant") },
        { id: "rwkv-tiny-instant", label: i18n("model-rwkv-tiny-instant") },
    ]
}

// A Statistics page shares these aligned arrays between Calibration, UM+, and ROC.
// Loading a model for a comparison alone does not start the expensive confidence bootstrap.
export function createModelPredictionSources() {
    let samples: CalibrationSamples | null = null
    let controller = new AbortController()
    let states: ModelPredictionStates = {}
    let needsBands = new Set<RwkvUmPlusModel>()
    const store = writable<ModelPredictionStates>(states)

    function update(model: RwkvUmPlusModel, state: ModelPredictionState) {
        states = { ...states, [model]: state }
        store.set(states)
    }

    function setSamples(next: CalibrationSamples | null) {
        if (samples === next) return
        controller.abort()
        controller = new AbortController()
        samples = next
        states = {}
        needsBands = new Set()
        store.set(states)
    }

    async function addBands(
        model: RwkvUmPlusModel,
        selected: CalibrationSamples,
        predictions: Float64Array,
        signal: AbortSignal
    ) {
        const state = states[model]
        if (!state || state.phase !== "ready" || state.bandsPending || state.bandsReady) return
        update(model, { ...state, bandsPending: true })
        try {
            const intervals = await runStatsTask(
                "calibrationBands",
                [selected, predictions],
                signal
            )
            const latest = states[model]
            if (!signal.aborted && latest?.predictions === predictions)
                update(model, {
                    ...latest,
                    bins: withConfidenceIntervals(latest.bins ?? [], intervals),
                    bandsPending: false,
                    bandsReady: true,
                })
        } catch (error) {
            if (!signal.aborted && states[model]?.predictions === predictions) {
                const message = error instanceof Error ? error.message : String(error)
                console.warn(
                    "Search Stats Extended: calibration confidence intervals failed:",
                    error
                )
                update(model, {
                    ...states[model]!,
                    bandsPending: false,
                    bandsReady: true,
                    warnings: [...(states[model]?.warnings ?? []), message],
                })
            }
        }
    }

    async function load(model: RwkvUmPlusModel, selected: CalibrationSamples, signal: AbortSignal) {
        try {
            const pages = await getRwkvUmPlusModelPages(
                model,
                selected.revlogIds,
                signal,
                (progress) => {
                    if (!signal.aborted) update(model, { phase: "loading", progress })
                }
            )
            signal.throwIfAborted()
            const parsed = await runStatsTask("calibrationPredictions", [selected, pages], signal)
            if (signal.aborted) return
            update(model, {
                phase: "ready",
                predictions: parsed.predictions,
                bins: parsed.bins,
                warnings: parsed.warnings,
            })
            if (needsBands.has(model)) void addBands(model, selected, parsed.predictions, signal)
        } catch (error) {
            if (!signal.aborted)
                update(model, {
                    phase: "failed",
                    error: error instanceof Error ? error.message : String(error),
                })
        }
    }

    function ensure(model: RwkvUmPlusModel, confidence = false) {
        if (confidence) needsBands.add(model)
        if (!samples) return
        const state = states[model]
        if (!state) {
            if (samples.revlogIds.length === 0) {
                update(model, {
                    phase: "ready",
                    predictions: new Float64Array(0),
                    bins: [],
                    bandsReady: true,
                })
                return
            }
            update(model, { phase: "loading" })
            void load(model, samples, controller.signal)
        } else if (confidence && state.phase === "ready" && state.predictions) {
            void addBands(model, samples, state.predictions, controller.signal)
        }
    }

    function retry(model: RwkvUmPlusModel) {
        if (states[model]?.phase !== "failed") return
        states = { ...states }
        delete states[model]
        store.set(states)
        ensure(model, needsBands.has(model))
    }

    function destroy() {
        controller.abort()
    }

    return { subscribe: store.subscribe, setSamples, ensure, retry, destroy }
}

export type ModelPredictionSources = ReturnType<typeof createModelPredictionSources>
