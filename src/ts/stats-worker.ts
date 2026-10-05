// Import calculations only after setting the page's scheduling/locale context.
// esbuild bundles these dynamic imports into this single standalone worker.
self.onmessage = async ({ data }) => {
    try {
        Object.assign(globalThis, { SSEother: data.context })
        const { runStatsTaskLocally } = await import("./statsTasks")
        const result = await runStatsTaskLocally(data.task, data.args)
        self.postMessage({ result })
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : String(error) })
    }
}
