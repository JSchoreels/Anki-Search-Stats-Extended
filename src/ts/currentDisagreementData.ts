import { UM_PLUS_BINS_PER_UNIT } from "./umPlusData"

export type CurrentPrediction = { cid: number; fsrs: number; rwkv: number }
export type CurrentScore = [number, number]
export type CurrentModelPair = { cid: number; first: number; second: number }
export type CurrentSourceStatus = "ready" | "pending" | "unavailable" | "failed"
export type CurrentModelScores = { status: CurrentSourceStatus; data: CurrentScore[] }
export type CurrentDisagreementResponse = {
    rows: CurrentPrediction[]
    total: number
    status: CurrentSourceStatus
    rwkvStatus: CurrentSourceStatus
    rwkvScores: CurrentScore[]
}
export type CurrentDisagreementBin = {
    index: number
    center: number
    lower: number
    upper: number
    cids: number[]
}

function validCurrentScore(cid: number, value: number) {
    return (
        Number.isSafeInteger(cid) && cid > 0 && Number.isFinite(value) && value >= 0 && value <= 1
    )
}

export function validCurrentPredictions(rows: CurrentPrediction[]): CurrentPrediction[] {
    const seen = new Set<number>()
    return rows.filter(({ cid, fsrs, rwkv }) => {
        if (seen.has(cid) || !validCurrentScore(cid, fsrs) || !validCurrentScore(cid, rwkv))
            return false
        seen.add(cid)
        return true
    })
}

export function pairCurrentModelScores(
    first: CurrentScore[],
    second: CurrentScore[]
): CurrentModelPair[] {
    const secondByCard = new Map<number, number>()
    for (const [cid, score] of second) {
        if (validCurrentScore(cid, score) && !secondByCard.has(cid)) secondByCard.set(cid, score)
    }
    const seen = new Set<number>()
    const pairs: CurrentModelPair[] = []
    for (const [cid, score] of first) {
        const other = secondByCard.get(cid)
        if (validCurrentScore(cid, score) && !seen.has(cid) && other !== undefined) {
            pairs.push({ cid, first: score, second: other })
            seen.add(cid)
        }
    }
    return pairs
}

export function buildCurrentDisagreementBins(rows: CurrentModelPair[]): CurrentDisagreementBin[] {
    const bins = new Map<number, CurrentDisagreementBin>()
    const seen = new Set<number>()
    for (const { cid, first, second } of rows) {
        if (seen.has(cid) || !validCurrentScore(cid, first) || !validCurrentScore(cid, second))
            continue
        seen.add(cid)
        const index = Math.round((first - second) * UM_PLUS_BINS_PER_UNIT)
        const center = index / UM_PLUS_BINS_PER_UNIT
        let bin = bins.get(index)
        if (!bin) {
            bin = {
                index,
                center,
                lower: Math.max(-1, center - 0.025),
                upper: Math.min(1, center + 0.025),
                cids: [],
            }
            bins.set(index, bin)
        }
        bin.cids.push(cid)
    }
    return [...bins.values()].sort((a, b) => a.index - b.index)
}
