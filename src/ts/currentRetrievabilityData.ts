import { validCurrentPredictions, type CurrentPrediction } from "./currentDisagreementData"

const BUCKET_COUNT = 20
export type CurrentRetrievabilityModel = "rwkv" | "fsrs"
export type CurrentRetrievabilityMembership = "both" | CurrentRetrievabilityModel
export type CurrentRetrievabilityBin = {
    index: number
    lower: number
    upper: number
    shifts: Record<CurrentRetrievabilityModel, Record<number, number[]>>
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
        shifts: { rwkv: {}, fsrs: {} },
    }))
    for (const { cid, fsrs, rwkv } of validCurrentPredictions(rows)) {
        const fsrsIndex = Math.min(BUCKET_COUNT - 1, Math.floor(fsrs * BUCKET_COUNT))
        const rwkvIndex = Math.min(BUCKET_COUNT - 1, Math.floor(rwkv * BUCKET_COUNT))
        if (fsrsIndex === rwkvIndex) {
            bins[fsrsIndex].both.push(cid)
        } else {
            bins[rwkvIndex].rwkv.push(cid)
            bins[fsrsIndex].fsrs.push(cid)
            const shift = rwkvIndex - fsrsIndex
            const rwkvCards = (bins[rwkvIndex].shifts.rwkv[shift] ??= [])
            const fsrsCards = (bins[fsrsIndex].shifts.fsrs[shift] ??= [])
            rwkvCards.push(cid)
            fsrsCards.push(cid)
        }
    }
    return bins
}
