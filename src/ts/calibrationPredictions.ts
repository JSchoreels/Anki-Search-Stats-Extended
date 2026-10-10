import type { CalibrationSamples } from "./calibrationSamples"

export type ParsedReviewRetrievability = {
    column: string | null
    predictions: Float64Array
    responsePredictionCount: number
    warnings: string[]
    roles: string[]
    roleCounts: Record<string, number>
    refreshAfterFsrs?: true
}

type PredictionMetadata = {
    column?: string | null
    warnings?: unknown[]
    roles?: unknown[]
    role_counts?: Record<string, unknown>
    refresh_after_fsrs?: boolean
}
type PredictionRow = [number, number | string | null]

function metadata(response: PredictionMetadata) {
    const roles = (response.roles ?? []).filter((role): role is string => typeof role === "string")
    const roleCounts: Record<string, number> = {}
    for (const [role, count] of Object.entries(response.role_counts ?? {})) {
        if (typeof count === "number" && Number.isInteger(count) && count >= 0) {
            roleCounts[role] = count
        }
    }
    const warnings = (response.warnings ?? []).filter(
        (warning): warning is string => typeof warning === "string" && warning.length > 0
    )
    return {
        column: response.column ?? null,
        warnings,
        roles,
        roleCounts,
        ...(response.refresh_after_fsrs === true ? { refreshAfterFsrs: true as const } : {}),
    }
}

class PredictionAlignment {
    readonly predictions: Float64Array
    responsePredictionCount = 0
    private sampleOrder: Uint32Array | undefined
    private sampleIndex = 0
    private revlogId: number | undefined
    private prediction = NaN

    constructor(private samples: CalibrationSamples) {
        this.predictions = new Float64Array(samples.revlogIds.length).fill(NaN)
        for (let i = 1; i < samples.revlogIds.length; i++) {
            if (samples.revlogIds[i] < samples.revlogIds[i - 1]) {
                this.sampleOrder = Uint32Array.from(samples.revlogIds, (_, index) => index)
                this.sampleOrder.sort((a, b) => samples.revlogIds[a] - samples.revlogIds[b])
                break
            }
        }
    }

    add(rows: PredictionRow[]) {
        for (const [id, raw] of rows) {
            if (this.revlogId !== undefined && id < this.revlogId) {
                throw new Error("Prediction pages are not ordered by review ID")
            }
            if (id !== this.revlogId) {
                this.flush()
                this.revlogId = id
                this.prediction = NaN
            }
            const value = typeof raw === "string" ? Number(raw) : raw
            if (typeof value === "number" && Number.isFinite(value)) this.prediction = value
        }
    }

    finish() {
        this.flush()
        this.revlogId = undefined
        return {
            predictions: this.predictions,
            responsePredictionCount: this.responsePredictionCount,
        }
    }

    private sampleAt(index: number) {
        return this.sampleOrder ? this.sampleOrder[index] : index
    }

    private flush() {
        if (this.revlogId === undefined || !Number.isFinite(this.prediction)) return
        this.responsePredictionCount++
        const ids = this.samples.revlogIds
        while (
            this.sampleIndex < ids.length &&
            ids[this.sampleAt(this.sampleIndex)] < this.revlogId
        )
            this.sampleIndex++
        while (
            this.sampleIndex < ids.length &&
            ids[this.sampleAt(this.sampleIndex)] === this.revlogId
        )
            this.predictions[this.sampleAt(this.sampleIndex++)] = this.prediction
    }
}

export function parseReviewRetrievabilityResponse(
    text: string,
    samples: CalibrationSamples
): ParsedReviewRetrievability {
    const response = JSON.parse(text) as PredictionMetadata & { data?: PredictionRow[] }
    const rows = response.data ?? []
    for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] < rows[i - 1][0]) {
            rows.sort((a, b) => a[0] - b[0])
            break
        }
    }
    const alignment = new PredictionAlignment(samples)
    alignment.add(rows)
    return { ...metadata(response), ...alignment.finish() }
}

// One response describes one complete cohort. Only a bounded page of JSON rows
// is parsed at a time, including duplicates that straddle page boundaries.
export async function parseReviewRetrievabilityPages(
    stream: ReadableStream<Uint8Array>,
    samples: CalibrationSamples
): Promise<ParsedReviewRetrievability> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const alignment = new PredictionAlignment(samples)
    let meta: ReturnType<typeof metadata> | undefined
    let expectedRows = 0
    let rows = 0
    let done = false
    let pending = ""
    const consume = (line: string) => {
        const page = JSON.parse(line)
        if (done) throw new Error("Unexpected data after prediction pages completed")
        if (!meta) {
            if (
                page.format !== "prediction-pages-v1" ||
                !Number.isInteger(page.row_count) ||
                page.row_count < 0
            )
                throw new Error("Invalid prediction page metadata")
            meta = metadata(page)
            expectedRows = page.row_count
        } else if (page.done === true) {
            if (rows !== expectedRows) throw new Error("Incomplete prediction pages")
            done = true
        } else {
            if (!Array.isArray(page.data) || page.data.length > 25000)
                throw new Error("Invalid prediction page")
            alignment.add(page.data)
            rows += page.data.length
            if (rows > expectedRows) throw new Error("Unexpected prediction rows")
        }
    }
    try {
        while (true) {
            const chunk = await reader.read()
            pending += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true })
            let from = 0
            let newline: number
            while ((newline = pending.indexOf("\n", from)) !== -1) {
                consume(pending.slice(from, newline))
                from = newline + 1
            }
            pending = pending.slice(from)
            if (chunk.done) break
        }
        if (pending) consume(pending)
        if (!meta || !done) throw new Error("Incomplete prediction pages")
        return { ...meta, ...alignment.finish() }
    } catch (error) {
        await reader.cancel().catch(() => {})
        throw error
    } finally {
        reader.releaseLock()
    }
}
