import { RevlogHistory } from "./packedRevlogs"

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
    const pages: Float64Array[] = []
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
        const fields = ["id", "cid", "ease", "ivl", "lastIvl", "time", "factor", "type"]
        const values = new Float64Array(response.data.length * 8)
        for (let i = 0; i < response.data.length; i++) {
            for (let field = 0; field < fields.length; field++)
                values[i * 8 + field] = response.data[i][idx[fields[field]]]
        }
        pages.push(values)
        total += values.length
        after_id = response.next_after_id ?? 0
    } while (after_id)
    const values = new Float64Array(total)
    let offset = 0
    for (const page of pages) {
        values.set(page, offset)
        offset += page.length
    }
    return new RevlogHistory(values)
}
