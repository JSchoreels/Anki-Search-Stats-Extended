import { mount, unmount } from "svelte"
import ExposureStabilityMatrix from "./ExposureStabilityMatrix.svelte"
import Root from "./Root.svelte"
import { attachCardCountsMatrix } from "./cardCountsMatrixPlacement"
import type { SSEconfig, SSEother } from "./config"
import { patchFetch } from "./root"
import { config, exposureStabilityVisible, other } from "./stores"
import { exportTroubleshootingInfo } from "./troubleshooting"

declare global {
    let css: string
    let SSEconfig: SSEconfig
    let SSEother: SSEother

    interface Window {
        bridgeCommand: (string: string) => void
        exportSseTroubleshooting: () => void
    }
}

patchFetch()

config.set(SSEconfig)
other.set(SSEother)
window.exportSseTroubleshooting = exportTroubleshootingInfo

setTimeout(() => {
    mount(Root, { target: document.body })
    attachCardCountsMatrix((target) => {
        const component = mount(ExposureStabilityMatrix, { target })
        return () => {
            void unmount(component)
        }
    }, exposureStabilityVisible.set)
}, SSEconfig.loadDelayMs ?? 100)

const style = document.createElement("style")
style.innerHTML = css
document.head.appendChild(style)
