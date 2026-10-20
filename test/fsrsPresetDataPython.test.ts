import { execFileSync } from "child_process"
import path from "path"

const results = JSON.parse(
    execFileSync("python3", [path.join(__dirname, "fsrsPresetDataFixture.py")], {
        encoding: "utf8",
    })
)

test("batch routing resolves each (preset id, home deck) once with identical card presets", () => {
    // Routes: kana/deck 1, "7"/deck 2 (cards 12 and filtered 13), "7"/deck 3.
    expect(results.batch.calls).toBe(3)
    expect(results.batch.expanded).toEqual(results.missing.expanded)
    expect(results.batch.presets).toBe(3)
})

test("cards sharing a preset id keep deck-specific overrides", () => {
    expect(results.batch.expanded["12"].desiredRetention).toBe(0.9)
    expect(results.batch.expanded["13"].desiredRetention).toBe(0.9)
    expect(results.batch.expanded["14"].desiredRetention).toBe(0.8)
})

test("builds without or with a failing batch lookup fall back to per-card resolution", () => {
    expect(results.missing.calls).toBe(6)
    expect(results.raises.calls).toBe(6)
    expect(results.raises.expanded).toEqual(results.missing.expanded)
})

test("builds without card_memory_metrics return the same presets and native retrievability", () => {
    expect(results.legacy.expanded).toEqual(results.batch.expanded)
    expect(results.legacy.retrievability).toEqual({ "10": 0.83, "12": 0, "14": 1 })
    expect(results.legacy.batchCalls).toEqual([])
    expect(results.legacy.statsCalls).toEqual([10, 11, 12, 13, 14, 15])
})

test("new builds keep batch metrics without loading full card statistics", () => {
    expect(results.batch.retrievability).toEqual({ "10": 0.83, "12": 0, "14": 1 })
    expect(results.batch.batchCalls).toEqual([[10, 11, 12, 13, 14, 15]])
    expect(results.batch.statsCalls).toEqual([])
})

test("an empty legacy search returns empty data without requesting card statistics", () => {
    expect(results.empty.expanded).toEqual({})
    expect(results.empty.retrievability).toEqual({})
    expect(results.empty.presets).toBe(0)
    expect(results.empty.statsCalls).toEqual([])
})

test("errors in an available metrics API are preserved instead of triggering legacy fallback", () => {
    expect(results.metricsError).toEqual({ error: "metrics failed", statsCalls: [] })
})
