import { checkParameters, type FSRS, fsrs as Fsrs, generatorParameters } from "ts-fsrs"
import type { DeckConfig } from "./config"
import { selectTsFsrsParams } from "./fsrsParams"

const deckFsrs: Record<number, { signature: string; model: FSRS }> = {}

export function getFsrsForConfig(config: DeckConfig) {
    const params = selectTsFsrsParams(config)
    const signature = `${params.length}:${params.join(",")}`
    if (!deckFsrs[config.id] || deckFsrs[config.id].signature !== signature) {
        deckFsrs[config.id] = {
            signature,
            model: Fsrs(
                generatorParameters({
                    w: checkParameters(params),
                    enable_fuzz: false,
                    enable_short_term: true,
                })
            ),
        }
    }
    return deckFsrs[config.id].model
}
