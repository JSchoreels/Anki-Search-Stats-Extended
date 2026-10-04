import { validCurrentPredictions, type CurrentPrediction } from "./currentDisagreementData"

const BUCKET_COUNT = 20
export type CurrentRetrievabilityMembership = "both" | "rwkv" | "fsrs"
export type CurrentRetrievabilityBin = {
    index: number
    lower: number
    upper: number
} & Record<CurrentRetrievabilityMembership, number[]>

export function buildCurrentRetrievabilityBins(
    rows: CurrentPrediction[]
): CurrentRetrievabilityBin[] {
    const bins: CurrentRetrievabilityBin[] = Array.from({ length: BUCKET_COUNT }, (_, index) => ({
        index,
        lower: index / BUCKET_COUNT,
        upper: (index + 1) / BUCKET_COUNT,
        both: [],
        rwkv: [],
        fsrs: [],
    }))
    for (const { cid, fsrs, rwkv } of validCurrentPredictions(rows)) {
        const fsrsIndex = Math.min(BUCKET_COUNT - 1, Math.floor(fsrs * BUCKET_COUNT))
        const rwkvIndex = Math.min(BUCKET_COUNT - 1, Math.floor(rwkv * BUCKET_COUNT))
        if (fsrsIndex === rwkvIndex) {
            bins[fsrsIndex].both.push(cid)
        } else {
            bins[rwkvIndex].rwkv.push(cid)
            bins[fsrsIndex].fsrs.push(cid)
        }
    }
    return bins
}
