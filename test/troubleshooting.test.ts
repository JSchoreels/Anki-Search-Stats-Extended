import { writable } from "svelte/store"

const ids = [Date.UTC(2026, 6, 2), Date.UTC(2026, 9, 5)]
const predictions = Object.fromEntries(ids.map((id) => [id, 0.9]))
const stores = {
    cids: writable([12]),
    searchLimit: writable(0),
    memorised_stats: writable<unknown>(null),
    fsrsCalibrationStats: writable<unknown>(null),
    rwkvCalibrationStats: writable<unknown>(null),
    fsrsCalibrationGeneration: writable<unknown>(null),
}
jest.doMock("../src/ts/stores", () => stores)

test("export reads current graph inputs and emits an aggregate report without fetching", async () => {
    const { exportTroubleshootingInfo } = await import("../src/ts/troubleshooting")
    const bridgeCommand = jest.fn()
    global.window = { bridgeCommand } as never
    const fetchSpy = jest.spyOn(global, "fetch")
    stores.memorised_stats.set({
        calibration_samples: ids.map((revlogId) => ({ cardId: 12, revlogId, actual: 1 })),
        fsrs_calibration_predictions_by_revlog_id: predictions,
    })
    stores.fsrsCalibrationStats.set({
        column: "fsrs-cache",
        roles: ["validation_fold"],
        cachedPredictionCount: 2,
        predictionsByRevlogId: predictions,
        warnings: [],
    })
    stores.rwkvCalibrationStats.set({
        column: "rwkv-cache",
        predictionsByRevlogId: predictions,
        warnings: [],
    })
    stores.fsrsCalibrationGeneration.set({ phase: "ready", generated: false, warnings: [] })
    exportTroubleshootingInfo()
    const report = JSON.parse(bridgeCommand.mock.calls[0][0].split(":").slice(1).join(":"))
    expect(report).toContain("SSE troubleshooting report build 2026-10-05.7")
    expect(report).toContain("Paired FSRS + RWKV reviews: 2")
    expect(report).toContain("2026-07-02T00:00:00.000Z to 2026-10-05T00:00:00.000Z")
    expect(report).toContain("Automatic FSRS calibration: ready")
    expect(report).toContain("FSRS generation result: reused existing data")
    expect(report).not.toContain(String(ids[0]))
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
})

test("export during loading identifies missing inputs and includes generation warnings", async () => {
    const { exportTroubleshootingInfo } = await import("../src/ts/troubleshooting")
    const bridgeCommand = jest.fn()
    global.window = { bridgeCommand } as never
    stores.memorised_stats.set(null)
    stores.fsrsCalibrationStats.set(null)
    stores.rwkvCalibrationStats.set(null)
    stores.fsrsCalibrationGeneration.set({
        phase: "failed",
        warnings: ["Generation was cancelled."],
    })
    exportTroubleshootingInfo()
    const report = JSON.parse(
        bridgeCommand.mock.calls[0][0].slice("sseExportTroubleshooting:".length)
    )
    expect(report).toContain("Calibration counts are not available yet")
    expect(report).toContain("FSRS history: not loaded")
    expect(report).toContain("Warning: Generation was cancelled.")
    expect(report).not.toContain("Paired FSRS + RWKV reviews: 0")
})
