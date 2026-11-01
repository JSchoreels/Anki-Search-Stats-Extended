import type { CardData } from "./cardData"
import type { DeckConfig, ResolvedFsrsPreset } from "./config"
import { prepareFsrsReplay } from "./fsrsHistory"
import { elapsedFsrsDays, type FsrsMemoryState, type FsrsModel, type FsrsSource } from "./fsrsModel"
import type { ReviewHorizon } from "./memorisedPerReview"
import { asRevlogHistory, type RevlogInput } from "./packedRevlogs"
import { dayFromMs, rollover_ms } from "./revlogGraphs"

export type ReviewProjection = {
    dayDelta: number
    withReview: number
    withoutReview: number
}

/** Update the matched predictions, reusing same-day FSRS-6 projections across horizons. */
export function projectReviewRecall(
    projection: ReviewProjection,
    model: FsrsModel,
    newState: FsrsMemoryState,
    previousState: FsrsMemoryState | null,
    elapsed: number,
    recallBefore: number,
    reviewId: number,
    reviewDay: number,
    horizon: ReviewHorizon
) {
    if (model.version === "seven") {
        const elapsedAfter = horizon / 86400
        projection.withReview = model.retrievability(newState, elapsedAfter)
        projection.withoutReview = previousState
            ? horizon === 0
                ? recallBefore
                : model.retrievability(previousState, elapsed + elapsedAfter)
            : 0
    } else {
        const dayDelta = horizon === 0 ? 0 : dayFromMs(reviewId + horizon * 1000) - reviewDay
        if (dayDelta !== projection.dayDelta) {
            projection.withReview = model.retrievability(newState, dayDelta)
            projection.withoutReview = previousState
                ? dayDelta === 0
                    ? recallBefore
                    : model.retrievability(previousState, elapsed + dayDelta)
                : 0
            projection.dayDelta = dayDelta
        }
    }
}

export type ReviewWindowSeries = {
    withReview: number[]
    withoutReview: number[]
    gain: number[]
}

/** Replay only when a review-count window is selected, retaining a bounded rolling window. */
export function calculateFsrsReviewWindow(
    input: RevlogInput,
    cards: Pick<CardData, "id" | "did" | "odid">[],
    configs: Record<number, DeckConfig>,
    configMapping: Record<number, number>,
    presets: Record<number, ResolvedFsrsPreset>,
    horizon: ReviewHorizon,
    reviews: number,
    snapshotNow = Date.now()
): ReviewWindowSeries {
    if (!Number.isSafeInteger(reviews) || reviews < 1) throw new Error("Invalid review window")
    const history = asRevlogHistory(input)
    const result: ReviewWindowSeries = { withReview: [], withoutReview: [], gain: [] }
    if (!history.length) return result
    const capacity = Math.min(reviews, history.length)
    const withValues = new Float64Array(capacity)
    const withoutValues = new Float64Array(capacity)
    const cardById = new Map(cards.map((card) => [card.id, card]))
    const source = (cid: number): FsrsSource | undefined => {
        if (presets[cid]) return presets[cid]
        const card = cardById.get(cid)
        return card ? configs[configMapping[card.odid || card.did]] : undefined
    }
    const states = new Map<number, { state: FsrsMemoryState; lastReview: Date }>()
    const projection: ReviewProjection = { dayDelta: -1, withReview: NaN, withoutReview: NaN }
    const today = dayFromMs(snapshotNow)
    let count = 0
    let withTotal = 0
    let withoutTotal = 0
    for (const { review, model, startingState, reset } of prepareFsrsReplay(history, source)) {
        const day = dayFromMs(review.id)
        if (day > today || review.id > snapshotNow) continue
        if (reset) states.delete(review.cid)
        if (review.ease === 0) continue
        const previous = states.get(review.cid)
        const oldState = previous && previous.state.stability > 0 ? previous.state : null
        const now = new Date(review.id)
        const elapsed =
            oldState && previous ? elapsedFsrsDays(model, previous.lastReview, now, rollover_ms) : 0
        const before = oldState
            ? model.retrievability(oldState, elapsed)
            : startingState
              ? undefined
              : 0
        const newState = startingState ?? model.nextState(oldState, elapsed, review.ease)
        if (before !== undefined && Number.isFinite(before)) {
            projection.dayDelta = -1
            projectReviewRecall(
                projection,
                model,
                newState,
                oldState,
                elapsed,
                before,
                review.id,
                day,
                horizon
            )
            const { withReview, withoutReview } = projection
            if (
                Number.isFinite(withReview) &&
                withReview >= 0 &&
                withReview <= 1 &&
                Number.isFinite(withoutReview) &&
                withoutReview >= 0 &&
                withoutReview <= 1
            ) {
                const slot = count % capacity
                if (count >= capacity) {
                    withTotal -= withValues[slot]
                    withoutTotal -= withoutValues[slot]
                }
                withValues[slot] = withReview
                withoutValues[slot] = withoutReview
                withTotal += withReview
                withoutTotal += withoutReview
                count++
                const denominator = Math.min(count, capacity)
                result.withReview[day] = (100 * withTotal) / denominator
                result.withoutReview[day] = (100 * withoutTotal) / denominator
                result.gain[day] = (100 * (withTotal - withoutTotal)) / denominator
            }
        }
        states.set(review.cid, { state: newState, lastReview: now })
    }
    for (const values of Object.values(result)) {
        for (let day = 0; day < values.length; day++) values[day] ??= NaN
    }
    return result
}
