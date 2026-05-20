import { createEmptyCard, S_MIN } from "ts-fsrs"
import { getFsrs } from "./MemorisedBar"
import {
    getExtraDataFromCard,
    getFsrsInternalStabilityFromExtraData,
    type CardData,
} from "./search"

const ANKI_MIN_FSRS_STABILITY = 0.0001

function stabilityForTsFsrs(stability: number) {
    if (!Number.isFinite(stability) || stability < ANKI_MIN_FSRS_STABILITY) {
        return
    }
    return Math.max(stability, S_MIN)
}

export function calculateEaseFactors(
    cards: CardData[],
    configs: typeof SSEother.deck_configs,
    config_mapping: typeof SSEother.deck_config_ids
) {
    return cards
        .map((c) => {
            const data = getExtraDataFromCard(c)
            if (!data.s || !data.d || !data.dr) {
                return
            }

            const difficulty = data.d
            const stability = getFsrsInternalStabilityFromExtraData(data)
            if (stability === undefined) {
                return
            }
            const dr = data.dr
            const effectiveStability = stabilityForTsFsrs(stability)
            if (effectiveStability === undefined) {
                return
            }

            const fsrs = getFsrs(configs[config_mapping[c.odid || c.did]])
            fsrs.parameters.request_retention = dr

            const fsrsCard = createEmptyCard()
            fsrsCard.difficulty = difficulty
            fsrsCard.stability = effectiveStability
            const interval = fsrs.next_interval(effectiveStability, 0)
            const next = fsrs.next_state(fsrsCard, interval, 3)
            return next.stability / effectiveStability
        })
        .filter((a) => a !== undefined)
}
