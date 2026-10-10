// Import calculations only after setting the page's scheduling/locale context.
// esbuild bundles these dynamic imports into this single standalone worker.
import { RevlogHistory } from "./packedRevlogs"

self.onmessage = async ({ data }) => {
    try {
        Object.assign(globalThis, { SSEother: data.context })
        const { runStatsTaskLocally } = await import("./statsTasks")
        if (
            data.task === "revlog" ||
            data.task === "memorised" ||
            data.task === "calibrationSamples"
        ) {
            data.args[0] = new RevlogHistory(data.args[0])
        }
        const result = await runStatsTaskLocally(data.task, data.args)
        self.postMessage({ result })
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : String(error) })
    }
}
