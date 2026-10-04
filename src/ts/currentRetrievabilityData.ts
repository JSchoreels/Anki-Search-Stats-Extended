import { validCurrentPredictions, type CurrentPrediction } from "./currentDisagreementData"

const BUCKET_COUNT = 20
const BUCKET_PERCENT = 100 / BUCKET_COUNT
export type CurrentRetrievabilityModel = "rwkv" | "fsrs"
export type CurrentRetrievabilityMembership = "both" | CurrentRetrievabilityModel
export type CurrentRetrievabilityBin = {
    index: number
    lower: number
    upper: number
    shifts: Record<CurrentRetrievabilityModel, Record<number, number[]>>
} & Record<CurrentRetrievabilityMembership, number[]>

function bucketIndex(retrievability: number): number {
    // Anki bins float32 predictions after multiplying by 100 in float32.
    // Preserve that rounding at boundaries such as 0.949999988 -> 95%.
    const percent = Math.fround(Math.fround(retrievability) * 100)
    return Math.min(BUCKET_COUNT - 1, Math.floor(percent / BUCKET_PERCENT))
}

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
        const fsrsIndex = bucketIndex(fsrs)
        const rwkvIndex = bucketIndex(rwkv)
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
