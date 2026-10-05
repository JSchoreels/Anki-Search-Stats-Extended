import { get } from "svelte/store"
import type { CardData, Revlog } from "./cardData"
import type { ResolvedFsrsPreset } from "./config"
import type { CurrentDisagreementResponse } from "./currentDisagreementData"
import { realFetch, searchJoin } from "./root"
import { searchString } from "./stores"
export * from "./cardData"

export async function getCurrentCardDisagreement(
    cids: number[]
): Promise<CurrentDisagreementResponse> {
    return endpoint("currentCardDisagreement", JSON.stringify(cids), false)
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

async function endpoint(endpoint: string, body?: string, alertOnError = true) {
    const resp = await realFetch(`/_anki/${endpoint}`, {
        method: "POST",
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

    const blob = await resp.text()
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

export async function getRevlogs(cids: number[], day_range: number) {
    const response = (await endpoint("revlogs", JSON.stringify({ cids, day_range }))) as {
        columns?: string[]
        data?: any[][]
    }

    if (!response.columns || !response.data) {
        alert("Search Stats Extended has been updated. Please restart Anki.")
        return null
    }

    // Build column index map once for efficient lookups
    const idx: Record<string, number> = {}
    response.columns.forEach((col, i) => (idx[col] = i))

    // Convert array-of-arrays to array-of-objects
    // Preallocate array for better performance
    const revlogs = new Array<Revlog>(response.data.length)
    for (let i = 0; i < response.data.length; i++) {
        const row = response.data[i]
        revlogs[i] = {
            id: row[idx.id],
            cid: row[idx.cid],
            ease: row[idx.ease] as 0 | 1 | 2 | 3 | 4,
            ivl: row[idx.ivl],
            lastIvl: row[idx.lastIvl],
            time: row[idx.time],
            factor: row[idx.factor],
            type: row[idx.type],
        }
    }

    return revlogs
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
    const response = (await endpoint(
        endpointName,
        JSON.stringify({
            cids,
            day_range,
            revlog_ids,
            ...(ensureFsrsAlignment ? { ensure_fsrs_alignment: true } : {}),
        })
    )) as {
        column?: string | null
        data?: [number, number | string | null][]
        warnings?: unknown[]
        roles?: unknown[]
        role_counts?: Record<string, unknown>
        refresh_after_fsrs?: boolean
    }
    const roles = (response.roles ?? []).filter((role): role is string => typeof role === "string")
    const roleCounts: Record<string, number> = {}
    for (const [role, count] of Object.entries(response.role_counts ?? {})) {
        if (typeof count === "number" && Number.isInteger(count) && count >= 0) {
            roleCounts[role] = count
        }
    }
    const predictionsByRevlogId: Record<number, number> = {}
    const warnings = (response.warnings ?? []).filter(
        (warning): warning is string => typeof warning === "string" && warning.length > 0
    )

    for (const [revlogId, rawPrediction] of response.data ?? []) {
        const prediction = typeof rawPrediction === "string" ? Number(rawPrediction) : rawPrediction
        if (typeof prediction === "number" && Number.isFinite(prediction)) {
            predictionsByRevlogId[revlogId] = prediction
        }
    }

    for (const warning of warnings) {
        console.warn("Search Stats Extended:", warning)
    }

    return {
        column: response.column ?? null,
        predictionsByRevlogId,
        warnings,
        roles,
        roleCounts,
        ...(response.refresh_after_fsrs === true ? { refreshAfterFsrs: true } : {}),
    }
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
