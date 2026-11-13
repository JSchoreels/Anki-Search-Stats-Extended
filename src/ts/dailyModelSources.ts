import { writable } from "svelte/store"
import type { CalibrationSamples } from "./calibrationSamples"
import type { DailyPredictionPoint } from "./dailyPredictionData"
import { runStatsTask } from "./statsWorkerClient"

export type DailyModelState = {
    phase: "loading" | "ready" | "failed"
    predictions: Float64Array | null
    data?: DailyPredictionPoint[]
    error?: string
}
export type DailyModelStates = Record<string, DailyModelState | undefined>

export function createDailyModelSources() {
    let samples: CalibrationSamples | null = null
    let states: DailyModelStates = {}
    const controllers = new Map<string, AbortController>()
    const selections = new Map<symbol, Set<string>>()
    const store = writable<DailyModelStates>(states)

    function update(model: string, state: DailyModelState) {
        states = { ...states, [model]: state }
        store.set(states)
    }

    function setSamples(next: CalibrationSamples | null) {
        if (samples === next) return
        for (const controller of controllers.values()) controller.abort()
        controllers.clear()
        samples = next
        states = {}
        store.set(states)
    }

    function ensure(
        model: string,
        predictions: Float64Array | null,
        precomputed?: DailyPredictionPoint[]
    ) {
        if (!samples) return
        const previous = states[model]
        if (previous && previous.predictions === predictions) {
            if (previous.phase === "loading" && precomputed) {
                controllers.get(model)?.abort()
                controllers.delete(model)
                update(model, { phase: "ready", predictions, data: precomputed })
            }
            return
        }
        controllers.get(model)?.abort()
        controllers.delete(model)
        if (precomputed || predictions === null) {
            update(model, { phase: "ready", predictions, data: precomputed ?? [] })
            return
        }
        const controller = new AbortController()
        controllers.set(model, controller)
        update(model, { phase: "loading", predictions })
        void runStatsTask("dailyPredictionData", [samples, predictions], controller.signal)
            .then((data) => {
                if (!controller.signal.aborted) update(model, { phase: "ready", predictions, data })
            })
            .catch((error) => {
                if (!controller.signal.aborted)
                    update(model, {
                        phase: "failed",
                        predictions,
                        error: error instanceof Error ? error.message : String(error),
                    })
            })
            .finally(() => {
                if (controllers.get(model) === controller) controllers.delete(model)
            })
    }

    function cancelUnselected() {
        const selected = new Set([...selections.values()].flatMap((models) => [...models]))
        for (const [model, controller] of controllers) {
            if (!selected.has(model) && states[model]?.phase === "loading") {
                controller.abort()
                controllers.delete(model)
                states = { ...states }
                delete states[model]
                store.set(states)
            }
        }
    }

    function select(owner: symbol, models: string[]) {
        selections.set(owner, new Set(models))
        cancelUnselected()
    }

    function release(owner: symbol) {
        selections.delete(owner)
        cancelUnselected()
    }

    function retry(model: string) {
        const state = states[model]
        if (!state || state.phase !== "failed") return
        states = { ...states }
        delete states[model]
        store.set(states)
        ensure(model, state.predictions)
    }

    return {
        subscribe: store.subscribe,
        setSamples,
        select,
        release,
        ensure,
        retry,
        destroy: () => setSamples(null),
    }
}

export type DailyModelSources = ReturnType<typeof createDailyModelSources>
