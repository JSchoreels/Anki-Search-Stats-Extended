import { writable } from "svelte/store"
import type { CurrentScore } from "./currentDisagreementData"
import {
    getCurrentRwkvModelPredictions,
    type RwkvUmPlusModel,
    type RwkvUmPlusProgress,
} from "./search"

export type CurrentModelState = {
    phase: "loading" | "ready" | "failed"
    progress?: RwkvUmPlusProgress
    scores?: CurrentScore[]
    error?: string
}
export type CurrentModelStates = Partial<Record<RwkvUmPlusModel, CurrentModelState>>

export function createCurrentModelSources() {
    let cards: number[] | null = null
    let states: CurrentModelStates = {}
    const controllers = new Map<RwkvUmPlusModel, AbortController>()
    const store = writable<CurrentModelStates>(states)

    function update(model: RwkvUmPlusModel, state: CurrentModelState) {
        states = { ...states, [model]: state }
        store.set(states)
    }

    function setCards(next: number[] | null) {
        if (cards === next) return
        for (const controller of controllers.values()) controller.abort()
        controllers.clear()
        cards = next
        states = {}
        store.set(states)
    }

    function ensure(model: RwkvUmPlusModel) {
        if (!cards || states[model]) return
        const selectedCards = cards
        const controller = new AbortController()
        controllers.set(model, controller)
        update(model, { phase: "loading" })
        void getCurrentRwkvModelPredictions(model, selectedCards, controller.signal, (progress) => {
            if (!controller.signal.aborted) update(model, { phase: "loading", progress })
        })
            .then((scores) => {
                if (!controller.signal.aborted) update(model, { phase: "ready", scores })
            })
            .catch((error) => {
                if (!controller.signal.aborted)
                    update(model, {
                        phase: "failed",
                        error: error instanceof Error ? error.message : String(error),
                    })
            })
            .finally(() => {
                if (controllers.get(model) === controller) controllers.delete(model)
            })
    }

    function select(models: RwkvUmPlusModel[]) {
        const selected = new Set(models)
        for (const [model, controller] of controllers) {
            if (!selected.has(model) && states[model]?.phase === "loading") {
                controller.abort()
                controllers.delete(model)
                states = { ...states }
                delete states[model]
                store.set(states)
            }
        }
        models.forEach(ensure)
    }

    function retry(model: RwkvUmPlusModel) {
        if (states[model]?.phase !== "failed") return
        states = { ...states }
        delete states[model]
        store.set(states)
        ensure(model)
    }

    function destroy() {
        setCards(null)
    }

    return { subscribe: store.subscribe, setCards, select, retry, destroy }
}
