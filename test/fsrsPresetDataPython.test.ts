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
