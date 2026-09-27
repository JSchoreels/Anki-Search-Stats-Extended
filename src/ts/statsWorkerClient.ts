import type { buildCalibrationBins, getMemorisedDays } from "./MemorisedBar"
import type { calculateRevlogStats } from "./revlogGraphs"

type Tasks = {
    revlog: typeof calculateRevlogStats
    memorised: typeof getMemorisedDays
    calibration: typeof buildCalibrationBins
}

export function runStatsTask<K extends keyof Tasks>(
    task: K,
    args: Parameters<Tasks[K]>,
    signal: AbortSignal
): Promise<Awaited<ReturnType<Tasks[K]>>> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException("Cancelled", "AbortError"))
            return
        }
        const worker = new Worker(SSEother.stats_worker_url)
        const cleanup = () => {
            worker.terminate()
            signal.removeEventListener("abort", cancel)
        }
        const fail = (error: Error) => {
            cleanup()
            reject(error)
        }
        const cancel = () => fail(new DOMException("Cancelled", "AbortError"))
        signal.addEventListener("abort", cancel, { once: true })
        worker.onmessage = ({ data }) => {
            cleanup()
            if (data.error) reject(new Error(data.error))
            else resolve(data.result)
        }
        worker.onerror = (event) => fail(new Error(event.message || "Stats worker failed"))
        worker.onmessageerror = () => fail(new Error("Could not read stats worker result"))
        try {
            worker.postMessage({ task, args, context: SSEother })
        } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)))
        }
    })
}
