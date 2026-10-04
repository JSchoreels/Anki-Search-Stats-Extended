import { fsrs as legacyPreviewFsrs } from "ts-fsrs-legacy-preview"
import { clipFSRS6Parameters, FSRS6Model, migrateFSRS6Parameters } from "ts-fsrs/models/fsrs-6"
import { FSRS7Model, type FSRS7State } from "ts-fsrs/models/fsrs-7"
import { ankiDayFromMs } from "./ankiDay"
import type { CardExtraData } from "./cardData"
import { getFsrsInternalStabilityFromExtraData } from "./cardData"
import type { DeckConfig, ResolvedFsrsPreset } from "./config"
import { selectResolvedFsrsPresetParams, selectTsFsrsParams } from "./fsrsParams"

export interface FsrsMemoryState {
    stability: number
    difficulty: number
    stabilityFast?: number
}

export interface FsrsModel {
    version: "six" | "seven" | "preview-seven"
    weights: readonly number[]
    minimumStability: number
    nextState(state: FsrsMemoryState | null, elapsedDays: number, rating: number): FsrsMemoryState
    retrievability(state: FsrsMemoryState, elapsedDays: number): number
    interval(state: FsrsMemoryState, desiredRetention: number): number
}

export type FsrsSource = DeckConfig | ResolvedFsrsPreset

function fullFsrs7State(state: FsrsMemoryState): FSRS7State {
    if (state.stabilityFast === undefined) {
        throw new Error("FSRS-7 requires fast stability, slow stability and difficulty")
    }
    return { ...state, stabilityFast: state.stabilityFast }
}

function solveInterval(model: FsrsModel, state: FsrsMemoryState, target: number) {
    let low = 0
    let high = Math.max(state.stability, 1)
    while (model.retrievability(state, high) > target && high < 36500) {
        high = Math.min(high * 2, 36500)
    }
    for (let i = 0; i < 50; i++) {
        const mid = (low + high) / 2
        if (model.retrievability(state, mid) > target) low = mid
        else high = mid
    }
    return (low + high) / 2
}

const models = new Map<string, FsrsModel>()

export function getFsrsForParams(params: readonly number[]): FsrsModel {
    if (![17, 19, 21, 34, 35].includes(params.length) || !params.every(Number.isFinite)) {
        throw new Error("Unsupported or non-finite FSRS parameters")
    }
    const signature = `${params.length}:${params.join(",")}`
    const cached = models.get(signature)
    if (cached) return cached

    let model: FsrsModel
    if (params.length === 34) {
        const core = FSRS7Model.create({ config: { weights: [...params] } })
        model = {
            version: "seven",
            weights: core.config.weights,
            minimumStability: core.bounds.sMin,
            nextState: (state, elapsedDays, rating) =>
                core.algorithm.next_state(
                    state ? fullFsrs7State(state) : null,
                    elapsedDays,
                    rating
                ),
            retrievability: (state, elapsedDays) =>
                core.forgettingCurve(fullFsrs7State(state), elapsedDays),
            interval: (state, target) => core.nextInterval(fullFsrs7State(state), target),
        }
    } else if (params.length === 35) {
        // Persisted preview weights describe a different model and cannot be converted to final FSRS-7.
        const preview = legacyPreviewFsrs({
            w: params,
            enable_fuzz: false,
            enable_short_term: true,
        })
        model = {
            version: "preview-seven",
            weights: preview.parameters.w,
            minimumStability: 0.0001,
            nextState: (state, elapsedDays, rating) =>
                preview.next_state(state, elapsedDays, rating),
            retrievability: (state, elapsedDays) =>
                preview.forgetting_curve(elapsedDays, state.stability),
            interval: (state, target) => solveInterval(model, state, target),
        }
    } else {
        // Preserve the existing 17/19 -> FSRS-6 parameter migration and same-day policy.
        const legacy = params.length === 17 || params.length === 19
        // Validate/clip the original layout first. Migration inserts zero short-term weights;
        // clipping those again would change the older model's equations.
        const weights = legacy
            ? migrateFSRS6Parameters(clipFSRS6Parameters([...params]))
            : [...params]
        const core = FSRS6Model.create({
            config: { weights, enableShortTerm: true, numRelearningSteps: 1 },
            migrate: !legacy,
            clip: !legacy,
            check: !legacy,
        })
        model = {
            version: "six",
            weights: core.config.weights,
            minimumStability: core.bounds.sMin,
            nextState: (state, elapsedDays, rating) =>
                core.algorithm.next_state(state, elapsedDays, rating),
            retrievability: (state, elapsedDays) => core.forgettingCurve(state, elapsedDays),
            interval: (state, target) => core.nextInterval(state, target),
        }
    }
    models.set(signature, model)
    return model
}

export function getFsrs(source: FsrsSource) {
    return getFsrsForParams(
        "params" in source ? selectResolvedFsrsPresetParams(source) : selectTsFsrsParams(source)
    )
}

export const getFsrsForConfig = getFsrs

export function elapsedFsrsDays(model: FsrsModel, previous: Date, now: Date, rolloverMs: number) {
    if (model.version === "seven") {
        return Math.max(0, (now.getTime() - previous.getTime()) / 86400000)
    }
    return Math.max(
        0,
        ankiDayFromMs(now.getTime(), rolloverMs / 3600000) -
            ankiDayFromMs(previous.getTime(), rolloverMs / 3600000)
    )
}

export function memoryStateFromCardData(
    model: FsrsModel,
    data: CardExtraData
): FsrsMemoryState | undefined {
    const stability =
        model.version === "seven" ? data.s_int : getFsrsInternalStabilityFromExtraData(data)
    if (stability === undefined || !Number.isFinite(stability) || stability < 0.0001) return
    if (model.version === "seven") {
        if (
            data.d === undefined ||
            !Number.isFinite(data.d) ||
            data.d < 1 ||
            data.d > 10 ||
            data.s_fast === undefined ||
            !Number.isFinite(data.s_fast) ||
            data.s_fast < 0.0001
        )
            return
        return { stability, stabilityFast: data.s_fast, difficulty: data.d }
    }
    return { stability: Math.max(stability, model.minimumStability), difficulty: data.d ?? 5 }
}

export function intervalAtRetrievability(model: FsrsModel, state: FsrsMemoryState, target: number) {
    return model.interval(state, Math.max(0.0001, Math.min(0.9999, target)))
}
