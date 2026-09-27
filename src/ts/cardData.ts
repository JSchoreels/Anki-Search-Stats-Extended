import { FSRS5_DEFAULT_DECAY } from "ts-fsrs"

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

export function intervalHistogram(cards: CardData[], includeSuspended: boolean) {
    const intervals: Record<number, number> = {}
    for (const card of cards) {
        if ((card.type === 2 || card.type === 3) && (includeSuspended || card.queue !== -1)) {
            intervals[card.ivl] = (intervals[card.ivl] ?? 0) + 1
        }
    }
    return intervals
}
