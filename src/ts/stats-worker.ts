// Import calculations only after setting the page's scheduling/locale context.
// esbuild bundles these dynamic imports into this single standalone worker.
self.onmessage = async ({ data }) => {
    try {
        Object.assign(globalThis, { SSEother: data.context })
        const { calculateRevlogStats } = await import("./revlogGraphs")
        const { getMemorisedDays, buildCalibrationBins } = await import("./MemorisedBar")
        let result
        switch (data.task) {
            case "revlog":
                result = calculateRevlogStats(
                    ...(data.args as Parameters<typeof calculateRevlogStats>)
                )
                break
            case "memorised":
                result = await getMemorisedDays(
                    ...(data.args as Parameters<typeof getMemorisedDays>)
                )
                break
            case "calibration":
                result = buildCalibrationBins(
                    ...(data.args as Parameters<typeof buildCalibrationBins>)
                )
                break
            default:
                throw new Error(`Unknown stats calculation: ${data.task}`)
        }
        self.postMessage({ result })
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : String(error) })
    }
}
