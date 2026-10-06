import type { CalibrationSamples } from "./calibrationSamples"
import type { Revlog } from "./cardData"
import type { DeckConfig, ResolvedFsrsPreset } from "./config"
import { selectFsrsHistory } from "./fsrsHistory"
import { elapsedFsrsDays, getFsrs, type FsrsSource } from "./fsrsModel"
import { applyOutlierFilter } from "./MemorisedBar"
import { dayFromMs, lastForgetByCard, rollover_ms } from "./revlogGraphs"

// Mirrors getMemorisedDays' calibration-sample selection without running FSRS.
export function selectCalibrationSamples(
    revlogs: Revlog[],
    cards: { id: number; did: number; odid: number }[],
    configs: Record<number, DeckConfig>,
    config_mapping: Record<number, number>,
    presetsByCard: Record<number, ResolvedFsrsPreset>,
    snapshotNow = Date.now()
): CalibrationSamples {
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
    const ids: number[] = [],
        cids: number[] = [],
        actual: number[] = []
    for (const { review, model, reset } of prepareSampleSelection(revlogs, source)) {
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
            ids.push(review.id)
            cids.push(review.cid)
            actual.push(review.ease > 1 ? 1 : 0)
        }
        lastReview.set(review.cid, review.id)
    }
    return {
        revlogIds: new Float64Array(ids),
        cardIds: new Float64Array(cids),
        actual: new Uint8Array(actual),
    }
}

// Same cycle selection and ordering as prepareFsrsReplay, without its starting-state bridge.
function prepareSampleSelection(
    revlogs: Revlog[],
    sourceForCard: (cid: number) => FsrsSource | undefined
) {
    const byCard = new Map<number, Revlog[]>()
    for (const review of revlogs) {
        const group = byCard.get(review.cid) ?? []
        group.push(review)
        byCard.set(review.cid, group)
    }
    const steps: { review: Revlog; model: ReturnType<typeof getFsrs>; reset: boolean }[] = []
    for (const [cid, group] of byCard) {
        const source = sourceForCard(cid)
        if (!source) continue
        const model = getFsrs(source)
        const cutoff = source.ignoreRevlogsBeforeDate
            ? Date.parse(`${source.ignoreRevlogsBeforeDate}T00:00:00Z`)
            : 0
        if (!Number.isFinite(cutoff)) throw new Error("Invalid FSRS history cutoff date")
        let cycle: Revlog[] = []
        let previousType: number | undefined
        const flush = () => {
            selectFsrsHistory(cycle, cutoff).reviews.forEach((review, index) =>
                steps.push({ review, model, reset: index === 0 })
            )
            cycle = []
        }
        for (const review of [...group].sort((a, b) => a.id - b.id)) {
            if (review.type === 4 && review.factor === 0) {
                flush()
                if (review.id >= cutoff) steps.push({ review, model, reset: true })
                previousType = undefined
            } else {
                if (review.ease > 0 && !(review.type === 3 && review.factor === 0)) {
                    if (review.type === 0 && previousType !== undefined && previousType !== 0)
                        flush()
                    previousType = review.type
                }
                cycle.push(review)
            }
        }
        flush()
    }
    return steps.sort((a, b) => a.review.id - b.review.id)
}
