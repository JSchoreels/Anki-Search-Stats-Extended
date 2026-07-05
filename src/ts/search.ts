import { get } from "svelte/store"
import { FSRS5_DEFAULT_DECAY } from "ts-fsrs"
import type { ResolvedFsrsPreset } from "./config"
import { realFetch, searchJoin } from "./root"
import { searchString } from "./stores"

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

export interface CardData {
    id: number
    nid: number
    did: number
    ord: number
    mod: number
    usn: number
    type: number
    // https://github.com/ankitects/anki/blob/main/pylib/anki/consts.py#L22-L29
    /*
    QUEUE_TYPE_MANUALLY_BURIED = CardQueue(-3)
    QUEUE_TYPE_SIBLING_BURIED = CardQueue(-2)
    QUEUE_TYPE_SUSPENDED = CardQueue(-1)
    QUEUE_TYPE_NEW = CardQueue(0)
    QUEUE_TYPE_LRN = CardQueue(1)
    QUEUE_TYPE_REV = CardQueue(2)
    QUEUE_TYPE_DAY_LEARN_RELEARN = CardQueue(3)
    QUEUE_TYPE_PREVIEW = CardQueue(4)
    */
    queue: number
    due: number
    ivl: number
    factor: number
    reps: number
    lapses: number
    left: number
    odue: number
    odid: number
    flags: number
    data: string
}

export interface CardExtraData {
    d?: number
    dr?: number
    pos?: number
    s?: number
    s_int?: number
    decay?: number
}

export function getExtraDataFromCard(card: CardData): CardExtraData {
    if (!card.data) {
        return {}
    }
    try {
        return JSON.parse(card.data)
    } catch {
        return {}
    }
}

export function getCardDecay(card: CardData) {
    return getDecay(getExtraDataFromCard(card))
}

export function getDecay(data: CardExtraData) {
    return data.decay ?? FSRS5_DEFAULT_DECAY
}

function positiveFinite(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

export function getFsrsS90FromExtraData(data: CardExtraData): number | undefined {
    return positiveFinite(data.s)
}

export function getFsrsInternalStabilityFromExtraData(data: CardExtraData): number | undefined {
    return positiveFinite(data.s_int) ?? getFsrsS90FromExtraData(data)
}

export function getFsrsS90FromCard(card: CardData): number | undefined {
    return getFsrsS90FromExtraData(getExtraDataFromCard(card))
}

export function getFsrsInternalStabilityFromCard(card: CardData): number | undefined {
    return getFsrsInternalStabilityFromExtraData(getExtraDataFromCard(card))
}

export interface Revlog {
    id: number
    cid: number
    //usn: number
    ease: 0 | 1 | 2 | 3 | 4
    ivl: number
    lastIvl: number
    factor: number
    time: number
    /*
    Learning = 0,
    Review = 1,
    Relearning = 2,
    /// Old Anki versions called this "Cram" or "Early". It's assigned when
    /// reviewing cards before they're due, or when rescheduling is
    /// disabled.
    Filtered = 3,
    Manual = 4,
    Rescheduled = 5,
    */
    type: number
}

export function uniqueRevlogCids(revlogs: Pick<Revlog, "cid">[]): number[] {
    return [...new Set(revlogs.map((revlog) => revlog.cid))]
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
        return {}
    }
    return (await endpoint("fsrsPresetData", JSON.stringify(cids))) as Record<
        number,
        ResolvedFsrsPreset
    >
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
    revlogIds: number[] = []
) {
    return getReviewRetrievability("rwkvReviewRetrievability", cids, day_range, revlogIds)
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
    revlogIds: number[] = []
) {
    const revlog_ids = [...new Set(revlogIds)].filter(
        (revlogId) => Number.isInteger(revlogId) && revlogId > 0
    )
    const response = (await endpoint(
        endpointName,
        JSON.stringify({ cids, day_range, revlog_ids })
    )) as {
        column?: string | null
        data?: [number, number | string | null][]
        warnings?: unknown[]
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
