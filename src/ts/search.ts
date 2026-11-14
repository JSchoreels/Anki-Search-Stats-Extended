import { get } from "svelte/store"
import type { CardData } from "./cardData"
import type { ResolvedFsrsPreset } from "./config"
import type {
    CurrentDisagreementResponse,
    CurrentModelScores,
    CurrentScore,
} from "./currentDisagreementData"
import { loadRevlogPages, MissingRevlogColumnsError } from "./revlogPages"
import { realFetch, searchJoin } from "./root"
import { searchString } from "./stores"
import type { WorkloadForecastProgress } from "./workloadForecastData"
export * from "./cardData"

export async function getCurrentCardDisagreement(
    cids: number[]
): Promise<CurrentDisagreementResponse> {
    return endpoint("currentCardDisagreement", JSON.stringify(cids), false)
}

export async function getCurrentFsrsModelPredictions(cids: number[], signal: AbortSignal) {
    const response = await fetchEndpoint(
        "currentFsrsModelPredictions",
        JSON.stringify({ cids }),
        false,
        signal
    )
    return (await response.json()) as CurrentModelScores
}

export async function getCurrentFsrs6ModelPredictions(cids: number[], signal: AbortSignal) {
    const response = await fetchEndpoint(
        "currentFsrs6ModelPredictions",
        JSON.stringify({ cids }),
        false,
        signal
    )
    return (await response.json()) as Omit<CurrentModelScores, "status"> & {
        status: "ready" | "unavailable" | "failed"
        missingParameters: number
        error?: string
    }
}

export async function getCurrentRwkvModelPredictions(
    model: RwkvUmPlusModel,
    cids: number[],
    signal: AbortSignal,
    onProgress: (progress: RwkvUmPlusProgress) => void
): Promise<CurrentScore[]> {
    let jobId: number | undefined
    try {
        // Read the job ID even if the selection changes while the request starts,
        // so the backend replay can always be cancelled.
        const initial = await fetchEndpoint(
            "startCurrentRwkvModel",
            JSON.stringify({ model, cids }),
            false
        )
        let state = (await initial.json()) as RwkvUmPlusProgress
        jobId = state.jobId
        signal.throwIfAborted()
        onProgress(state)
        while (!state.done) {
            if (jobId === undefined) throw new Error("RWKV model preparation has no job ID")
            await calibrationPollDelay(signal)
            const response = await fetchEndpoint(
                "currentRwkvModelProgress",
                JSON.stringify({ job_id: jobId }),
                false,
                signal
            )
            state = (await response.json()) as RwkvUmPlusProgress
            onProgress(state)
        }
        if (state.phase !== "complete" || jobId === undefined)
            throw new Error(state.error || "RWKV model preparation failed")
        const response = await fetchEndpoint(
            "currentRwkvModelPredictions",
            JSON.stringify({ job_id: jobId }),
            false,
            signal
        )
        const result = (await response.json()) as { data: CurrentScore[] }
        if (!Array.isArray(result.data)) throw new Error("Missing current model predictions")
        return result.data
    } finally {
        if (jobId !== undefined)
            void endpoint("cancelCurrentRwkvModel", JSON.stringify({ job_id: jobId }), false).catch(
                () => {}
            )
    }
}

export async function getWorkloadForecastAvailable(): Promise<boolean> {
    const response = await endpoint("workloadForecastAvailable", "{}", false)
    return response?.available === true
}

export async function startWorkloadForecast(request: {
    search: string
    days: number
    paths: number
    fast?: boolean
}): Promise<WorkloadForecastProgress> {
    return endpoint("startWorkloadForecast", JSON.stringify(request), false)
}

export async function getWorkloadForecastProgress(
    jobId: number
): Promise<WorkloadForecastProgress> {
    return endpoint("workloadForecastProgress", JSON.stringify({ job_id: jobId }), false)
}

export async function cancelWorkloadForecast(jobId: number) {
    await endpoint("cancelWorkloadForecast", JSON.stringify({ job_id: jobId }), false)
}

export function browseCurrentDisagreementCards(cids: number[]) {
    if (cids.length) window.bridgeCommand(`currentDisagreementBrowse:${JSON.stringify(cids)}`)
}

export function catchErrors<Return>(func: () => Return): Return {
    try {
        return func()
    } catch (e: any) {
        alert(`Search Stats Extended has encountered an error.

--- *** If you have recently updated the addon please ensure you have restarted Anki. *** ---

JS:
${e?.stack ? e.stack : e}`)
        throw e
    }
}

async function fetchEndpoint(
    endpoint: string,
    body?: string,
    alertOnError = true,
    signal?: AbortSignal
) {
    const resp = await realFetch(`/_anki/${endpoint}`, {
        method: "POST",
        signal,
        body,
        headers: { "Content-Type": "application/binary" },
    })

    if (!resp.ok) {
        const responseText = await resp.text()
        if (alertOnError) {
            alert(`Search Stats Extended has encountered an error.

--- *** If you have recently updated the addon please ensure you have restarted Anki. *** ---




If the problem persists copy the following information into a github issue (https://github.com/Luc-Mcgrady/Anki-Search-Stats-Extended/issues/new) with a description of what you were doing at the time:

Fetch Response: ${resp.status}
${responseText}`)
        }
        throw new Error(`Endpoint ${endpoint} failed: ${resp.status} ${responseText}`)
    }

    return resp
}

async function endpointText(endpoint: string, body?: string, alertOnError = true) {
    return (await fetchEndpoint(endpoint, body, alertOnError)).text()
}

async function endpoint(endpoint: string, body?: string, alertOnError = true) {
    const blob = await endpointText(endpoint, body, alertOnError)
    // Handle empty responses (e.g., from writeConfig endpoint)
    if (blob === "") {
        return null
    }
    return JSON.parse(blob)
}

export async function search(search: string) {
    return (await endpoint("cardSearch", search)) as number[]
}

export async function openLocaleFolder() {
    await endpoint("openLocaleFolder")
}

export async function getCardData(cids: number[]) {
    const response = (await endpoint("cardData", JSON.stringify(cids))) as {
        columns?: string[]
        data?: any[][]
    }

    if (!response.columns || !response.data) {
        alert(
            "Search Stats Extended has been updated. Some graphs may not work until you restart Anki."
        )
        return []
    }

    const idx: Record<string, number> = {}
    response.columns.forEach((col, i) => (idx[col] = i))
    const cards = new Array<CardData>(response.data.length)
    for (let i = 0; i < response.data.length; i++) {
        const row = response.data[i]
        cards[i] = {
            id: row[idx.id],
            nid: row[idx.nid],
            did: row[idx.did],
            ord: row[idx.ord],
            mod: row[idx.mod],
            usn: row[idx.usn],
            type: row[idx.type],
            queue: row[idx.queue],
            due: row[idx.due],
            ivl: row[idx.ivl],
            factor: row[idx.factor],
            reps: row[idx.reps],
            lapses: row[idx.lapses],
            left: row[idx.left],
            odue: row[idx.odue],
            odid: row[idx.odid],
            flags: row[idx.flags],
            data: row[idx.data],
        }
    }
    return cards
}

export async function getFsrsPresetData(cids: number[]) {
    if (cids.length === 0) {
        return { presetsByCard: {}, retrievability: {} } as FsrsPresetData
    }
    const { presets, cards, retrievability } = (await endpoint(
        "fsrsPresetData",
        JSON.stringify(cids)
    )) as {
        presets: ResolvedFsrsPreset[]
        cards: Record<number, number>
        retrievability: Record<number, number>
    }
    return {
        presetsByCard: Object.fromEntries(
            Object.entries(cards).map(([cid, index]) => [cid, presets[index]])
        ),
        retrievability,
    }
}

export interface FsrsPresetData {
    presetsByCard: Record<number, ResolvedFsrsPreset>
    retrievability: Record<number, number>
}

export async function saveConfigValue(key: string, value: any) {
    await endpoint("writeConfig", JSON.stringify({ key, value }))
}

export async function saveFsrsReviewRetrievability(predictionsByRevlogId: Record<number, number>) {
    const data = Object.entries(predictionsByRevlogId)
        .map(([revlogId, prediction]) => [Number(revlogId), prediction])
        .filter(
            ([revlogId, prediction]) =>
                Number.isInteger(revlogId) &&
                revlogId > 0 &&
                typeof prediction === "number" &&
                Number.isFinite(prediction) &&
                prediction >= 0 &&
                prediction <= 1
        )

    if (data.length === 0) {
        return
    }

    await endpoint(
        "cacheFsrsReviewRetrievability",
        JSON.stringify({ source: "stats_fsrs_replay", data }),
        false
    )
}

export async function getRevlogs(cids: number[], day_range: number, signal?: AbortSignal) {
    try {
        return await loadRevlogPages(
            async (after_id) => endpoint("revlogs", JSON.stringify({ cids, day_range, after_id })),
            signal
        )
    } catch (error) {
        if (!(error instanceof MissingRevlogColumnsError)) throw error
        alert(error.message)
        return null
    }
}

export async function getRwkvReviewRetrievability(
    cids: number[],
    day_range: number,
    revlogIds: number[] = [],
    ensureFsrsAlignment = false
) {
    return getReviewRetrievability(
        "rwkvReviewRetrievability",
        cids,
        day_range,
        revlogIds,
        ensureFsrsAlignment
    )
}

export type RwkvMemorisedHistoryProgress = {
    phase: "idle" | "loading" | "computing" | "complete" | "cancelled" | "failed" | "unavailable"
    current: number
    total: number
    firstDay?: number | null
    completedThroughDay?: number | null
    retrievabilityByDay?: number[]
    noteRetrievabilityByDay?: number[]
    cardCountByDay?: number[]
    done: boolean
    error?: string | null
}

export async function startRwkvMemorisedHistory(cids: number[]) {
    return (await endpoint(
        "startRwkvMemorisedHistory",
        JSON.stringify({ cids })
    )) as RwkvMemorisedHistoryProgress
}

export async function getRwkvMemorisedHistoryProgress(cids: number[]) {
    return (await endpoint(
        "rwkvMemorisedHistoryProgress",
        JSON.stringify({ cids })
    )) as RwkvMemorisedHistoryProgress
}

export async function cancelRwkvMemorisedHistory() {
    await endpoint("cancelRwkvMemorisedHistory", "{}", false)
}

export type RwkvReviewGainProgress = {
    jobId?: number
    phase: string
    current?: number
    total?: number
    firstDay?: number | null
    gainByDay?: number[]
    withByDay?: number[]
    withoutByDay?: number[]
    countByDay?: number[]
    slowReplay?: boolean | null
    done: boolean
    error?: string | null
}

export async function startRwkvReviewGain(cids: number[], dayRange: number, horizonSeconds = 0) {
    return (await endpoint(
        "startRwkvReviewGain",
        JSON.stringify({ cids, day_range: dayRange, horizon_seconds: horizonSeconds }),
        false
    )) as RwkvReviewGainProgress
}

export async function getRwkvReviewGainProgress(jobId: number) {
    return (await endpoint(
        "rwkvReviewGainProgress",
        JSON.stringify({ job_id: jobId }),
        false
    )) as RwkvReviewGainProgress
}

export type RwkvReviewGainWindow = {
    jobId: number
    firstDay: number | null
    withByDay: (number | null)[]
    withoutByDay: (number | null)[]
    gainByDay: (number | null)[]
}

export async function getRwkvReviewGainWindow(jobId: number, reviews: number) {
    return (await endpoint(
        "rwkvReviewGainWindow",
        JSON.stringify({ job_id: jobId, reviews }),
        false
    )) as RwkvReviewGainWindow
}

export async function cancelRwkvReviewGain(jobId: number) {
    await endpoint("cancelRwkvReviewGain", JSON.stringify({ job_id: jobId }), false)
}

export type RwkvStabilityProgress = {
    jobId?: number
    phase: "loading" | "waiting" | "computing" | "complete" | "cancelled" | "failed"
    current?: number
    total?: number
    firstDay?: number | null
    medianByDay?: (number | null)[]
    meanByDay?: (number | null)[]
    youngRatioByDay?: (number | null)[]
    cardCountByDay?: number[]
    done: boolean
    error?: string | null
}

export async function startRwkvStabilityHistory(cids: number[]) {
    return (await endpoint(
        "startRwkvStabilityHistory",
        JSON.stringify({ cids }),
        false
    )) as RwkvStabilityProgress
}

export async function getRwkvStabilityHistoryProgress(jobId: number) {
    return (await endpoint(
        "rwkvStabilityHistoryProgress",
        JSON.stringify({ job_id: jobId }),
        false
    )) as RwkvStabilityProgress
}

export async function cancelRwkvStabilityHistory(jobId: number) {
    await endpoint("cancelRwkvStabilityHistory", JSON.stringify({ job_id: jobId }), false)
}

export type FsrsCalibrationProgress = {
    phase: "queued" | "running" | "ready" | "failed"
    label?: string
    currentPreset?: number
    totalPresets?: number
    coversRequest?: boolean
    generated?: boolean
    warnings: string[]
}

function calibrationPollDelay(signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer)
            reject(new DOMException("Statistics request cancelled", "AbortError"))
        }
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort)
            resolve()
        }, 1000)
        signal.addEventListener("abort", abort, { once: true })
        if (signal.aborted) abort()
    })
}

export type RwkvUmPlusModel =
    | "rwkv-big"
    | "rwkv-small-curve"
    | "rwkv-small-instant"
    | "rwkv-tiny-instant"

export type RwkvUmPlusProgress = {
    jobId?: number
    phase: string
    current?: number
    total?: number
    done: boolean
    error?: string | null
    warnings?: string[]
}

export type FsrsSixComparisonRole = "final_fit" | "validation_fold"

export async function getFsrsSixComparisonPages(
    deckIds: number[],
    reviewIds: Float64Array,
    role: FsrsSixComparisonRole,
    signal: AbortSignal,
    onProgress: (progress: RwkvUmPlusProgress) => void
): Promise<string | ReadableStream<Uint8Array>> {
    let jobId: number | undefined
    try {
        const initial = await fetchEndpoint(
            "startFsrs6Comparison",
            JSON.stringify({
                deck_ids: deckIds,
                revlog_ids: [...new Set(reviewIds)].filter((id) => Number.isInteger(id) && id > 0),
                role,
            }),
            false
        )
        let state = (await initial.json()) as RwkvUmPlusProgress
        jobId = state.jobId
        signal.throwIfAborted()
        onProgress(state)
        while (!state.done) {
            if (jobId === undefined) throw new Error("FSRS-6 comparison has no job ID")
            await calibrationPollDelay(signal)
            const response = await fetchEndpoint(
                "fsrs6ComparisonProgress",
                JSON.stringify({ job_id: jobId }),
                false,
                signal
            )
            state = (await response.json()) as RwkvUmPlusProgress
            onProgress(state)
        }
        if (state.phase !== "complete" || jobId === undefined)
            throw new Error(state.error || "FSRS-6 comparison could not be prepared")
        const response = await fetchEndpoint(
            "fsrs6ComparisonPredictions",
            JSON.stringify({ job_id: jobId, stream_pages: true }),
            false,
            signal
        )
        if (!response.headers?.get("Content-Type")?.startsWith("application/x-ndjson"))
            return response.text()
        if (!response.body) throw new Error("Missing FSRS-6 prediction stream")
        return response.body
    } finally {
        if (jobId !== undefined)
            void endpoint("cancelFsrs6Comparison", JSON.stringify({ job_id: jobId }), false).catch(
                () => {}
            )
    }
}

export async function getRwkvUmPlusModelPages(
    model: RwkvUmPlusModel,
    reviewIds: Float64Array,
    signal: AbortSignal,
    onProgress: (progress: RwkvUmPlusProgress) => void
): Promise<string | ReadableStream<Uint8Array>> {
    async function status(endpoint: string, body: object) {
        const response = await fetchEndpoint(endpoint, JSON.stringify(body), false, signal)
        return JSON.parse(await response.text()) as RwkvUmPlusProgress
    }
    let state = await status("startRwkvUmPlusModel", { model })
    onProgress(state)
    while (!state.done) {
        if (state.jobId === undefined) throw new Error("RWKV model preparation has no job ID")
        await calibrationPollDelay(signal)
        state = await status("rwkvUmPlusModelProgress", { job_id: state.jobId })
        onProgress(state)
    }
    if (state.phase !== "complete" || state.jobId === undefined)
        throw new Error(state.error || "RWKV model preparation failed")
    const response = await fetchEndpoint(
        "rwkvUmPlusModelPredictions",
        JSON.stringify({
            job_id: state.jobId,
            revlog_ids: [...new Set(reviewIds)].filter((id) => Number.isInteger(id) && id > 0),
            stream_pages: true,
        }),
        false,
        signal
    )
    if (!response.headers?.get("Content-Type")?.startsWith("application/x-ndjson"))
        return response.text()
    if (!response.body) throw new Error("Missing prediction page stream")
    return response.body
}

export async function ensureFsrsCalibration(
    cids: number[],
    signal: AbortSignal,
    onProgress: (state: FsrsCalibrationProgress) => void
): Promise<string[]> {
    try {
        let needsOwnRequest = true
        while (needsOwnRequest) {
            signal.throwIfAborted()
            let state = (await endpoint(
                "startFsrsCalibration",
                JSON.stringify({ cids }),
                false
            )) as FsrsCalibrationProgress
            needsOwnRequest = state.coversRequest === false
            while (state.phase === "queued" || state.phase === "running") {
                signal.throwIfAborted()
                onProgress(state)
                await calibrationPollDelay(signal)
                state = (await endpoint(
                    "fsrsCalibrationProgress",
                    "{}",
                    false
                )) as FsrsCalibrationProgress
            }
            signal.throwIfAborted()
            onProgress(state)
            if (state.phase === "failed") return state.warnings
            if (!needsOwnRequest) return state.warnings
        }
        return []
    } catch (error) {
        signal.throwIfAborted()
        const warnings = [
            `Historical FSRS calibration is unavailable: ${error instanceof Error ? error.message : error}. Restart Anki after installing this update.`,
        ]
        onProgress({ phase: "failed", warnings })
        return warnings
    }
}

export async function getFsrsReviewRetrievability(
    cids: number[],
    day_range: number,
    revlogIds: number[] = []
) {
    return getReviewRetrievability("fsrsReviewRetrievability", cids, day_range, revlogIds)
}

async function getReviewRetrievability(
    endpointName: "fsrsReviewRetrievability" | "rwkvReviewRetrievability",
    cids: number[],
    day_range: number,
    revlogIds: number[] = [],
    ensureFsrsAlignment = false
) {
    const revlog_ids = [...new Set(revlogIds)].filter(
        (revlogId) => Number.isInteger(revlogId) && revlogId > 0
    )
    return endpointText(
        endpointName,
        JSON.stringify({
            cids,
            day_range,
            revlog_ids,
            ...(ensureFsrsAlignment ? { ensure_fsrs_alignment: true } : {}),
        })
    )
}

export async function getReviewRetrievabilityPages(
    model: "fsrs" | "rwkv",
    cids: number[],
    day_range: number,
    revlogIds: Float64Array,
    signal: AbortSignal,
    ensureFsrsAlignment = false
): Promise<string | ReadableStream<Uint8Array>> {
    signal.throwIfAborted()
    const response = await fetchEndpoint(
        `${model}ReviewRetrievability`,
        JSON.stringify({
            cids,
            day_range,
            revlog_ids: [...new Set(revlogIds)].filter((id) => Number.isInteger(id) && id > 0),
            stream_pages: true,
            ...(ensureFsrsAlignment ? { ensure_fsrs_alignment: true } : {}),
        }),
        true,
        signal
    )
    // Anki may still be running the Python module from before an add-on update.
    if (!response.headers?.get("Content-Type")?.startsWith("application/x-ndjson"))
        return response.text()
    if (!response.body) throw new Error("Missing prediction page stream")
    return response.body
}

export function browserSearch(search: string) {
    window.bridgeCommand(`browserSearch:${search}`)
}

export function browserSearchCurrent(search: string) {
    browserSearch(searchJoin(get(searchString), search))
}

export function browserSearchCids(cids: (number | string)[]) {
    browserSearch(`cid:${cids.join(",")}`)
}
