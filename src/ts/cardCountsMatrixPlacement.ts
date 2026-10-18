/** Keep the add-on panel beside the native graph without changing Anki's bundle. */
export function attachCardCountsMatrix(
    mountPanel: (host: HTMLElement) => () => void,
    visible: (value: boolean) => void
) {
    let current: { anchor: Element; host: HTMLElement; destroy: () => void } | undefined
    function clear() {
        if (!current) return
        current.destroy()
        current.host.remove()
        current = undefined
        visible(false)
    }
    function update() {
        const anchor = document
            .querySelector(".counts-outer")
            ?.closest(".graphs-container > .container")
        if (!anchor?.parentElement) {
            clear()
            return
        }
        if (current?.anchor === anchor && current.host.isConnected) return
        clear()
        const host = document.createElement("div")
        host.className = "sse-card-counts-matrix"
        host.style.cssText = "display:flex;min-width:0;width:100%"
        anchor.after(host)
        current = { anchor, host, destroy: mountPanel(host) }
        visible(true)
    }
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true })
    update()
    return () => {
        observer.disconnect()
        clear()
    }
}
