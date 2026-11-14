import { writable } from "svelte/store"
import type { CurrentScore } from "./currentDisagreementData"
import type { ExplicitModel } from "./modelPredictionSources"
import {
    getCurrentFsrs6ModelPredictions,
    getCurrentRwkvModelPredictions,
    type RwkvUmPlusProgress,
} from "./search"

export type CurrentModelState = {
    phase: "loading" | "ready" | "failed" | "unavailable"
    progress?: RwkvUmPlusProgress
    scores?: CurrentScore[]
    error?: string
    missingParameters?: number
}
export type CurrentModelStates = Partial<Record<ExplicitModel, CurrentModelState>>

export function createCurrentModelSources() {
    let cards: number[] | null = null
    let states: CurrentModelStates = {}
    const controllers = new Map<ExplicitModel, AbortController>()
    const store = writable<CurrentModelStates>(states)

    function update(model: ExplicitModel, state: CurrentModelState) {
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

    function ensure(model: ExplicitModel) {
        if (!cards || states[model]) return
        const selectedCards = cards
        const controller = new AbortController()
        controllers.set(model, controller)
        update(model, { phase: "loading" })
        const request =
            model === "fsrs6"
                ? getCurrentFsrs6ModelPredictions(selectedCards, controller.signal).then(
                      (result) => ({
                          phase: result.status,
                          scores: result.data,
                          missingParameters: result.missingParameters,
                          error: result.error,
                      })
                  )
                : getCurrentRwkvModelPredictions(
                      model,
                      selectedCards,
                      controller.signal,
                      (progress) => {
                          if (!controller.signal.aborted)
                              update(model, { phase: "loading", progress })
                      }
                  ).then((scores) => ({ phase: "ready" as const, scores }))
        void request
            .then((state) => {
                if (!controller.signal.aborted) update(model, state)
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

    function select(models: ExplicitModel[]) {
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

    function retry(model: ExplicitModel) {
        if (states[model]?.phase !== "failed" && states[model]?.phase !== "unavailable") return
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
