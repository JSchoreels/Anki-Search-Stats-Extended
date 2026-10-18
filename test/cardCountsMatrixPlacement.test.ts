/** @jest-environment jsdom */
import { attachCardCountsMatrix } from "../src/ts/cardCountsMatrixPlacement"
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))
function nativeCounts() {
    const node = document.createElement("div")
    node.className = "container"
    node.innerHTML =
        '<h1>Native counts</h1><div class="graph"><div class="counts-outer"></div></div>'
    return node
}
afterEach(() => {
    document.body.innerHTML = ""
})

test("inserts beside native counts when it arrives, preserves it during redraw and releases on replacement", async () => {
    document.body.innerHTML = '<div class="graphs-container"></div>'
    const container = document.querySelector(".graphs-container")!
    const destroyed = jest.fn(),
        visible = jest.fn(),
        mount = jest.fn((host: HTMLElement) => {
            host.innerHTML = "<table>Matrix</table>"
            return destroyed
        })
    const stop = attachCardCountsMatrix(mount, visible)
    expect(mount).not.toHaveBeenCalled()
    const counts = nativeCounts()
    container.append(counts)
    await settled()
    expect(counts.nextElementSibling?.className).toBe("sse-card-counts-matrix")
    expect(mount).toHaveBeenCalledTimes(1)
    counts.querySelector("h1")!.textContent = "Updated counts"
    await settled()
    expect(mount).toHaveBeenCalledTimes(1)
    counts.remove()
    await settled()
    expect(destroyed).toHaveBeenCalledTimes(1)
    expect(document.querySelector(".sse-card-counts-matrix")).toBeNull()
    const replacement = nativeCounts()
    container.append(replacement)
    await settled()
    expect(mount).toHaveBeenCalledTimes(2)
    expect(replacement.nextElementSibling?.className).toBe("sse-card-counts-matrix")
    stop()
    await settled()
    expect(destroyed).toHaveBeenCalledTimes(2)
    expect(visible).toHaveBeenLastCalledWith(false)
    container.append(nativeCounts())
    await settled()
    expect(mount).toHaveBeenCalledTimes(2)
})
