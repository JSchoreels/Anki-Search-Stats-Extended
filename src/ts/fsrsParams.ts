import { default_w } from "ts-fsrs"
import type { DeckConfig } from "./config"

const TS_FSRS_SUPPORTED_PARAM_LENGTHS = [17, 19, 21, 35]

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
    const configParams = [
        config.fsrsParams7,
        config.fsrsParams6,
        config.fsrsParams5,
        config.fsrsParams4,
        config.fsrsWeights,
    ]

    return configParams.find(isTsFsrsCompatible) ?? [...default_w]
}
