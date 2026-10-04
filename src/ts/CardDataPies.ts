import { forgettingCurve as forgetting_curve } from "ts-fsrs/models/fsrs-6"
import { dueDayOffset } from "./cardDue"
import type { DeckConfig } from "./config"
import { getFsrsForConfig, memoryStateFromCardData } from "./fsrsModel"
import {
    getDecay,
    getExtraDataFromCard,
    getFsrsInternalStabilityFromExtraData,
    type CardData,
} from "./search"

export function calculateCardDataPies(
    cardData: CardData[],
    include_suspended: boolean,
    zero_inclusive: boolean,
    deckConfigs: Record<number, DeckConfig> | undefined = SSEother.deck_configs,
    deckConfigIds: Record<number, number> | undefined = SSEother.deck_config_ids
) {
    let lapses: number[] = []
    let repetitions: number[] = []
    let lapses_burden: number[] = []
    let repetitions_burden: number[] = []
    let target_R_days: number[] = []
    const target_R_day_totals: number[] = []
    const days_elapsed = SSEother.days_elapsed

    for (const card of cardData ?? []) {
        if (include_suspended || card.queue !== -1) {
            if (card.reps > 0) {
                lapses[card.lapses] = (lapses[card.lapses] ?? 0) + 1
                repetitions[card.reps] = (repetitions[card.reps] ?? 0) + 1

                const burden = card.ivl > 0 ? 1 / card.ivl : 1

                lapses_burden[card.lapses] = (lapses_burden[card.lapses] ?? 0) + burden
                repetitions_burden[card.reps] = (repetitions_burden[card.reps] ?? 0) + burden

                const extraData = getExtraDataFromCard(card)
                const stability = getFsrsInternalStabilityFromExtraData(extraData)
                if (stability && card.ivl > 0 && card.type == 2 && card.queue > 0) {
                    const due = dueDayOffset(card, days_elapsed)
                    const deckConfigId = deckConfigIds?.[card.odid || card.did]
                    const deckConfig =
                        deckConfigId === undefined ? undefined : deckConfigs?.[deckConfigId]
                    let target_R: number
                    if (deckConfig) {
                        const model = getFsrsForConfig(deckConfig)
                        const state = memoryStateFromCardData(model, extraData)
                        if (!state) continue
                        target_R = model.retrievability(state, card.ivl)
                    } else {
                        if (extraData.s_fast !== undefined) continue
                        target_R = forgetting_curve(getDecay(extraData), card.ivl, stability)
                    }
                    target_R_days[due] = (target_R_days[due] ?? 0) + target_R
                    target_R_day_totals[due] = (target_R_day_totals[due] ?? 0) + 1
                }
            }
        }
    }

    if (!zero_inclusive) {
        delete lapses[0]
        delete lapses_burden[0]
    }

    return {
        lapses,
        repetitions,
        lapses_burden,
        repetitions_burden,
        target_R_days,
        target_R_day_totals,
    }
}
