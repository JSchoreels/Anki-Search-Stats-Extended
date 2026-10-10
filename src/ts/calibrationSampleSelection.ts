import { CalibrationSampleBuilder, type CalibrationSamples } from "./calibrationSamples"
import type { DeckConfig, ResolvedFsrsPreset } from "./config"
import { prepareFsrsReplay } from "./fsrsHistory"
import { elapsedFsrsDays, type FsrsSource } from "./fsrsModel"
import { applyOutlierFilter } from "./MemorisedBar"
import { asRevlogHistory, type RevlogInput } from "./packedRevlogs"
import { dayFromMs, lastForgetByCard, rollover_ms } from "./revlogGraphs"

// Mirrors getMemorisedDays' calibration-sample selection without running FSRS.
export function selectCalibrationSamples(
    input: RevlogInput,
    cards: { id: number; did: number; odid: number }[],
    configs: Record<number, DeckConfig>,
    config_mapping: Record<number, number>,
    presetsByCard: Record<number, ResolvedFsrsPreset>,
    snapshotNow = Date.now()
): CalibrationSamples {
    const revlogs = asRevlogHistory(input)
    const excluded = applyOutlierFilter(revlogs)
    const lastForget = lastForgetByCard(revlogs)
    const homeDeck = new Map(cards.map((c) => [c.id, c.odid || c.did]))
    const source = (cid: number): FsrsSource | undefined => {
        if (presetsByCard[cid]) return presetsByCard[cid]
        const deck = homeDeck.get(cid)
        return deck === undefined ? undefined : configs[config_mapping[deck]]
    }
    const snapshotToday = dayFromMs(snapshotNow)
    const lastReview = new Map<number, number>()
    const samples = new CalibrationSampleBuilder()
    for (const { review, model, reset } of prepareFsrsReplay(revlogs, source, false)) {
        if (dayFromMs(review.id) > snapshotToday || review.id > snapshotNow) continue
        if (reset) lastReview.delete(review.cid)
        if (review.ease === 0) continue
        const previous = lastReview.get(review.cid)
        if (
            previous !== undefined &&
            elapsedFsrsDays(model, new Date(previous), new Date(review.id), rollover_ms) >= 1 &&
            (lastForget[review.cid] ?? 0) < review.id &&
            !excluded.has(review.id)
        ) {
            samples.add(review.id, review.cid, review.ease > 1 ? 1 : 0)
        }
        lastReview.set(review.cid, review.id)
    }
    return samples.finish().samples
}
