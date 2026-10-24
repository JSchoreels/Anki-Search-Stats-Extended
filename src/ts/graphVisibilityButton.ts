import { derived } from "svelte/store"
import { i18n } from "./i18n"
import { hiddenGraphs, showHiddenGraphs } from "./stores"

declare global {
    interface Window {
        toggleSseHiddenGraphs?: () => void
    }
}

/** Keep the native Statistics button in sync with the current webview. */
export function connectGraphVisibilityButton() {
    window.toggleSseHiddenGraphs = () => showHiddenGraphs.update((shown) => !shown)
    const stop = derived([hiddenGraphs.ids, showHiddenGraphs], (values) => values).subscribe(
        ([ids, shown]) => {
            window.bridgeCommand(
                `sseHiddenGraphsState:${JSON.stringify({
                    count: ids.length,
                    shown,
                    label: i18n(shown ? "hide-hidden-graphs" : "show-hidden-graphs", {
                        count: ids.length,
                    }),
                })}`
            )
        }
    )
    return () => {
        stop()
        delete window.toggleSseHiddenGraphs
    }
}
