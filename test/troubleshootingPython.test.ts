import { execFileSync } from "child_process"
import path from "path"

const result = JSON.parse(
    execFileSync("python3", [path.join(__dirname, "troubleshootingFixture.py")], {
        encoding: "utf8",
    })
)

test("native export button joins Save PDF once and delegates to the live web report", () => {
    expect(result.buttons).toEqual(["Save PDF", "Export troubleshooting info"])
    expect(result.auto_default).toBe(false)
    expect(result.click_script).toContain("window.exportSseTroubleshooting()")
    expect(result.click_script).toContain("sseTroubleshootingLoading")
    expect(result.unknown).toBe(false)
})

test("save exports UTF-8 aggregates plus Anki capabilities, with a native .txt chooser", () => {
    expect(result.saved).toContain("Anki version: 26.10; build: test-build")
    expect(result.saved).toContain("Historical FSRS calibration API: available")
    expect(result.saved).toContain("Paired FSRS + RWKV reviews: 144197")
    expect(result.saved).toContain("UTF-8: é")
    expect(result.save_options).toMatchObject({ title: "Export troubleshooting info", ext: ".txt" })
})

test("cancel writes nothing; loading, malformed reports and write failures are reported", () => {
    expect(result.cancel_files).toBe(1)
    expect(result.loading).toContain("Statistics is still loading")
    expect(result.invalid_warning).toContain("Expected a text troubleshooting report")
    expect(result.write_warning).toContain("Could not export troubleshooting info")
})
