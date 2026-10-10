import {
    allocateRevlogColumns,
    REVLOG_FIELDS,
    RevlogHistory,
    type RevlogColumns,
} from "./packedRevlogs"

export class MissingRevlogColumnsError extends Error {
    constructor() {
        super("Search Stats Extended has been updated. Please restart Anki.")
    }
}

export type RevlogPage = {
    columns?: string[]
    data?: number[][]
    next_after_id?: number | null
}

export async function loadRevlogPages(
    fetchPage: (afterId: number) => Promise<RevlogPage>,
    signal?: AbortSignal
): Promise<RevlogHistory> {
    const pages: RevlogColumns[] = []
    let total = 0
    let after_id = 0
    do {
        signal?.throwIfAborted()
        const response = await fetchPage(after_id)
        signal?.throwIfAborted()
        if (!response.columns || !response.data) {
            throw new MissingRevlogColumnsError()
        }
        const idx: Record<string, number> = {}
        response.columns.forEach((col, i) => (idx[col] = i))
        const values = allocateRevlogColumns(response.data.length)
        for (let i = 0; i < response.data.length; i++) {
            for (const field of REVLOG_FIELDS) {
                const value = response.data[i][idx[field]]
                values[field][i] = value
                if (values[field][i] !== value)
                    throw new Error(`Invalid review-history ${field}: ${value}`)
            }
        }
        pages.push(values)
        total += response.data.length
        after_id = response.next_after_id ?? 0
    } while (after_id)
    const values = allocateRevlogColumns(total)
    let offset = 0
    for (const page of pages) {
        for (const field of REVLOG_FIELDS) values[field].set(page[field], offset)
        offset += page.id.length
    }
    return new RevlogHistory(values)
}
