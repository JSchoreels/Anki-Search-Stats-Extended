import type { Revlog } from "./cardData"
import { getFsrs, type FsrsMemoryState, type FsrsModel, type FsrsSource } from "./fsrsModel"

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

// Anki's missing-history bridge: the first retained interval describes a POST-review state.
// Native references: fsrs-rs model_v6/v7::memory_state_from_sm2_scalar and
// Anki scheduler/fsrs/memory_state.rs::fsrs_item_for_memory_state.
export function stateFromIncompleteHistory(
    model: FsrsModel,
    review: Revlog,
    retention: number
): FsrsMemoryState {
    const interval = Math.max(1, review.ivl)
    const ease = (review.factor || 2500) / 1000
    const encodedDifficulty = ease <= 1.1 ? (ease - 0.1) * 9 + 1 : undefined
    if (!(retention > 0 && retention < 1)) throw new Error("Invalid FSRS historical retention")
    if (model.version === "six") {
        const w = model.weights
        const decay = -w[20]
        const stability = (interval * (0.9 ** (1 / decay) - 1)) / (retention ** (1 / decay) - 1)
        const difficulty =
            encodedDifficulty ??
            11 -
                (ease - 1) /
                    (Math.exp(w[8]) * stability ** -w[9] * Math.expm1((1 - retention) * w[10]))
        return { stability, difficulty: clamp(difficulty, 1, 10) }
    }

    // FSRS-7 has no scalar ease bridge. Native Anki starts with D=5 and a fast/slow
    // ratio of 0.8, then decodes FSRS difficulty if present and rescales both traces.
    const solve = (difficulty: number, ratio: number) => {
        const stateAt = (logS: number): FsrsMemoryState => {
            const stability = clamp(Math.exp(logS), model.minimumStability, 36500)
            return {
                stability,
                difficulty,
                ...(model.version === "seven"
                    ? { stabilityFast: clamp(stability * ratio, model.minimumStability, 36500) }
                    : {}),
            }
        }
        let low = Math.log(model.minimumStability)
        let high = Math.log(36500)
        const elapsed = clamp(interval, model.minimumStability, 36500)
        if (model.retrievability(stateAt(low), elapsed) >= retention) return stateAt(low)
        if (model.retrievability(stateAt(high), elapsed) <= retention) return stateAt(high)
        for (let i = 0; i < 48; i++) {
            const mid = (low + high) / 2
            if (model.retrievability(stateAt(mid), elapsed) < retention) low = mid
            else high = mid
        }
        return stateAt((low + high) / 2)
    }
    const shape = solve(5, 0.8)
    return encodedDifficulty === undefined
        ? shape
        : solve(
              encodedDifficulty,
              shape.stabilityFast === undefined ? 1 : shape.stabilityFast / shape.stability
          )
}

function isCram(review: Revlog) {
    return review.type === 3 && review.factor === 0
}
function isReset(review: Revlog) {
    return review.type === 4 && review.factor === 0
}

// Port of Anki's reviews_for_fsrs(..., training=false). Cutoff dates are UTC midnight.
export function selectFsrsHistory(entries: Revlog[], cutoffMs: number) {
    let firstLearning: number | undefined
    let firstGrade: number | undefined
    let complete = false
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i]
        if (isCram(entry)) continue
        if (entry.ease > 0 && entry.id > cutoffMs && (entry.ivl >= 1 || entry.ivl <= -86400))
            firstGrade = i
        if (entry.ease > 0 && entry.type === 0) {
            firstLearning = i
            complete = true
        } else if (isReset(entry)) {
            if (firstLearning !== undefined) {
                complete = true
                break
            }
            if (firstGrade !== undefined) {
                complete = false
                break
            }
            return { reviews: [], complete: false }
        } else if (firstLearning !== undefined) break
    }
    if (
        firstLearning !== undefined &&
        entries[firstLearning].id < cutoffMs &&
        firstLearning < entries.length - 1
    ) {
        firstLearning = undefined
        complete = false
    }
    const start = firstLearning ?? firstGrade
    return {
        reviews:
            start === undefined ? [] : entries.slice(start).filter((e) => e.ease > 0 && !isCram(e)),
        complete,
    }
}

export type FsrsReplayStep = {
    review: Revlog
    model: FsrsModel
    // Present only when the first retained grade is already represented by an SM-2 bridge.
    startingState?: FsrsMemoryState
    reset: boolean
}

// Preserve earlier learning cycles for historical graphs while applying native initialization
// independently to each cycle. The final cycle is the one native current-state replay uses.
export function prepareFsrsReplay(
    reviews: Revlog[],
    sourceForCard: (cid: number) => FsrsSource | undefined
): FsrsReplayStep[] {
    const byCard = new Map<number, Revlog[]>()
    for (const review of reviews) {
        const group = byCard.get(review.cid) ?? []
        group.push(review)
        byCard.set(review.cid, group)
    }
    const steps: FsrsReplayStep[] = []
    // Same bridge inputs produce the same state; keep this cache scoped to one replay.
    const startingStates = new Map<FsrsModel, Map<string, FsrsMemoryState>>()
    const startingState = (model: FsrsModel, review: Revlog, retention: number) => {
        const states = startingStates.get(model) ?? new Map<string, FsrsMemoryState>()
        startingStates.set(model, states)
        const key = `${Math.max(1, review.ivl)}:${review.factor || 2500}:${retention}`
        if (!states.has(key)) states.set(key, stateFromIncompleteHistory(model, review, retention))
        return states.get(key)!
    }
    for (const [cid, group] of byCard) {
        const source = sourceForCard(cid)
        if (!source) continue
        const model = getFsrs(source)
        const cutoff = source.ignoreRevlogsBeforeDate
            ? Date.parse(`${source.ignoreRevlogsBeforeDate}T00:00:00Z`)
            : 0
        if (!Number.isFinite(cutoff)) throw new Error("Invalid FSRS history cutoff date")
        const retention =
            "historicalRetention" in source
                ? source.historicalRetention
                : (source.sm2Retention ?? 0.9)
        const sorted = [...group].sort((a, b) => a.id - b.id)
        let cycle: Revlog[] = []
        let previousType: number | undefined
        const flush = () => {
            const selected = selectFsrsHistory(cycle, cutoff)
            selected.reviews.forEach((review, index) =>
                steps.push({
                    review,
                    model,
                    reset: index === 0,
                    ...(!selected.complete && index === 0
                        ? { startingState: startingState(model, review, retention) }
                        : {}),
                })
            )
            cycle = []
        }
        for (const review of sorted) {
            if (isReset(review)) {
                flush()
                if (review.id >= cutoff) steps.push({ review, model, reset: true })
                previousType = undefined
            } else {
                if (review.ease > 0 && !isCram(review)) {
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
