import { getFsrs, intervalAtRetrievability, memoryStateFromCardData } from "./fsrsModel"
import { getExtraDataFromCard, type CardData } from "./search"

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

            const dr = data.dr
            const config = configs[config_mapping[c.odid || c.did]]
            if (!config) return
            const fsrs = getFsrs(config)
            const state = memoryStateFromCardData(fsrs, data)
            if (!state) {
                return
            }
            const interval = intervalAtRetrievability(fsrs, state, dr)
            const next = fsrs.nextState(state, interval, 3)
            return next.stability / state.stability
        })
        .filter((a) => a !== undefined)
}
