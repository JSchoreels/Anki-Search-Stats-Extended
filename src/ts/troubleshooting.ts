import { get } from "svelte/store"
import { calibrationDiagnosticReport } from "./calibrationDiagnostics"
import {
    cids,
    fsrsCalibrationGeneration,
    fsrsCalibrationStats,
    memorised_stats,
    rwkvCalibrationStats,
    searchLimit,
} from "./stores"

export function exportTroubleshootingInfo() {
    const samples = get(memorised_stats)
    const fsrs = get(fsrsCalibrationStats)
    const rwkv = get(rwkvCalibrationStats)
    const generation = get(fsrsCalibrationGeneration)
    const warnings = [
        ...new Set([
            ...(generation?.warnings ?? []),
            ...(fsrs?.warnings ?? []),
            ...(rwkv?.warnings ?? []),
        ]),
    ]
    const report = [
        samples && fsrs && rwkv
            ? calibrationDiagnosticReport(
                  samples.calibration_samples ?? [],
                  samples.fsrs_calibration_predictions_by_revlog_id,
                  fsrs,
                  rwkv,
                  get(searchLimit)
              )
            : "SSE troubleshooting report build 2026-10-05.6\nCalibration counts are not available yet; wait for the graphs to load or enable FSRS statistics.",
        `Exported at (UTC): ${new Date().toISOString()}`,
        `Matched cards: ${get(cids)?.length ?? "loading"}`,
        `FSRS history: ${samples ? "loaded" : "not loaded"}; FSRS cache: ${fsrs ? "loaded" : "not loaded"}; RWKV cache: ${rwkv ? "loaded" : "not loaded"}`,
        `Automatic FSRS calibration: ${generation?.phase ?? "waiting for FSRS history"}`,
        ...(generation?.phase === "ready" && typeof generation.generated === "boolean"
            ? [`FSRS generation result: ${generation.generated ? "generated predictions" : "reused existing data"}`]
            : []),
        ...warnings.map((warning) => `Warning: ${warning}`),
    ].join("\n")
    window.bridgeCommand(`sseExportTroubleshooting:${JSON.stringify(report)}`)
}
