import { FSRS6_DEFAULT_WEIGHTS } from "ts-fsrs/models/fsrs-6"
import type { DeckConfig, ResolvedFsrsPreset } from "./config"

const TS_FSRS_SUPPORTED_PARAM_LENGTHS = [17, 19, 21, 34, 35]
const FSRS_VERSION_SEVEN = 0
const FSRS_VERSION_SIX = 1
const FSRS_VERSION_FIVE = 2
const FSRS_VERSION_FOUR = 3

function isTsFsrsCompatible(params: number[] | undefined): params is number[] {
    if (!Array.isArray(params) || params.length === 0) {
        return false
    }
    if (!TS_FSRS_SUPPORTED_PARAM_LENGTHS.includes(params.length)) {
        return false
    }
    return params.every((value) => Number.isFinite(value))
}

export function selectTsFsrsParams(config: DeckConfig): number[] {
    const selectedParams =
        config.fsrsVersion === FSRS_VERSION_SIX
            ? config.fsrsParams6
            : config.fsrsVersion === FSRS_VERSION_FIVE
              ? config.fsrsParams5
              : config.fsrsVersion === FSRS_VERSION_FOUR
                ? config.fsrsParams4
                : config.fsrsParams7

    if (isTsFsrsCompatible(selectedParams)) {
        return selectedParams
    }

    const configParams = [
        config.fsrsParams7,
        config.fsrsParams6,
        config.fsrsParams5,
        config.fsrsParams4,
        config.fsrsWeights,
    ]

    return configParams.find(isTsFsrsCompatible) ?? [...FSRS6_DEFAULT_WEIGHTS]
}

export function selectResolvedFsrsPresetParams(preset: ResolvedFsrsPreset): number[] {
    const paramCount = Array.isArray(preset.params) ? preset.params.length : 0
    if (!isTsFsrsCompatible(preset.params)) {
        throw new Error(
            `Resolved FSRS preset ${preset.id} has unsupported params length ${paramCount}`
        )
    }
    return preset.params
}
