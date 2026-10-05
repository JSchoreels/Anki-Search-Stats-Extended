import { alignPredictions, type CalibrationSamples } from "./calibrationSamples"

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
    return {
        column: response.column ?? null,
        predictions: alignPredictions(samples, predictionsByRevlogId),
        responsePredictionCount: Object.keys(predictionsByRevlogId).length,
        warnings,
        roles,
        roleCounts,
        ...(response.refresh_after_fsrs === true ? { refreshAfterFsrs: true } : {}),
    }
}
