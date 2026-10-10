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

export function parseReviewRetrievabilityResponse(
    text: string,
    samples: CalibrationSamples
): ParsedReviewRetrievability {
    const response = JSON.parse(text) as {
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
    const warnings = (response.warnings ?? []).filter(
        (warning): warning is string => typeof warning === "string" && warning.length > 0
    )
    // Merge sorted rows into typed output instead of building a second, large
    // object keyed by timestamp IDs. Stable sorting preserves last-valid duplicate wins.
    const rows = response.data ?? []
    rows.sort((a, b) => a[0] - b[0])
    const sampleOrder = Uint32Array.from(samples.revlogIds, (_, index) => index)
    sampleOrder.sort((a, b) => samples.revlogIds[a] - samples.revlogIds[b])
    const predictions = new Float64Array(samples.revlogIds.length).fill(NaN)
    let responsePredictionCount = 0
    let sampleIndex = 0
    for (let rowIndex = 0; rowIndex < rows.length; ) {
        const revlogId = rows[rowIndex][0]
        let prediction = NaN
        do {
            const raw = rows[rowIndex++][1]
            const value = typeof raw === "string" ? Number(raw) : raw
            if (typeof value === "number" && Number.isFinite(value)) prediction = value
        } while (rowIndex < rows.length && rows[rowIndex][0] === revlogId)
        if (!Number.isFinite(prediction)) continue
        responsePredictionCount++
        while (
            sampleIndex < sampleOrder.length &&
            samples.revlogIds[sampleOrder[sampleIndex]] < revlogId
        )
            sampleIndex++
        while (
            sampleIndex < sampleOrder.length &&
            samples.revlogIds[sampleOrder[sampleIndex]] === revlogId
        )
            predictions[sampleOrder[sampleIndex++]] = prediction
    }
    return {
        column: response.column ?? null,
        predictions,
        responsePredictionCount,
        warnings,
        roles,
        roleCounts,
        ...(response.refresh_after_fsrs === true ? { refreshAfterFsrs: true } : {}),
    }
}
