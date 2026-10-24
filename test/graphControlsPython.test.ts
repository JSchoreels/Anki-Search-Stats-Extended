import { execFileSync } from "child_process"
import path from "path"

const result = JSON.parse(
    execFileSync("python3", [path.join(__dirname, "graphControlsFixture.py")], { encoding: "utf8" })
)

test("native hidden-graph toggle joins the bottom Statistics actions once and delegates to the webview", () => {
    expect(result.buttons).toEqual([
        "Save PDF",
        "Export troubleshooting info",
        "Show hidden graphs",
    ])
    expect(result.initial).toEqual([false, false, true, false])
    expect(result.script).toBe("window.toggleSseHiddenGraphs?.();")
    expect(result.unknown).toBe(false)
})

test("native text, checked state and visibility follow the frontend's hidden graph count", () => {
    expect(result.hidden).toEqual(["Show hidden graphs (2)", true, true, false])
    expect(result.shown).toEqual(["Hide hidden graphs (2)", true, true, true])
    expect(result.empty).toEqual(["Show hidden graphs (0)", false, true, false])
})
