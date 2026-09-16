import { UM_PLUS_BINS_PER_UNIT } from "./umPlusData"

export type CurrentPrediction = { cid: number; fsrs: number; rwkv: number }
export type CurrentDisagreementResponse = {
    rows: CurrentPrediction[]
    total: number
    status: "ready" | "pending" | "unavailable" | "failed"
}
export type CurrentDisagreementBin = {
    index: number
    center: number
    lower: number
    upper: number
    cids: number[]
}

export function buildCurrentDisagreementBins(rows: CurrentPrediction[]): CurrentDisagreementBin[] {
    const bins = new Map<number, CurrentDisagreementBin>()
    const seen = new Set<number>()
    for (const { cid, fsrs, rwkv } of rows) {
        if (
            seen.has(cid) ||
            !Number.isSafeInteger(cid) ||
            cid <= 0 ||
            !Number.isFinite(fsrs) ||
            !Number.isFinite(rwkv) ||
            fsrs < 0 ||
            fsrs > 1 ||
            rwkv < 0 ||
            rwkv > 1
        )
            continue
        seen.add(cid)
        const index = Math.round((fsrs - rwkv) * UM_PLUS_BINS_PER_UNIT)
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
