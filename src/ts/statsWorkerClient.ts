import { asRevlogHistory, copyRevlogValues, type RevlogInput } from "./packedRevlogs"
import { StatsHistory } from "./statsHistory"
import type { Tasks } from "./statsTasks"
import { scheduleStatsTask } from "./statsWorkerQueue"
import { resultTransfers } from "./workerTransfers"
export { loadStatsHistory } from "./statsHistory"

type HistoryTask = "revlog" | "memorised" | "calibrationSamples" | "maturation"
type TaskArgs<K extends keyof Tasks> = K extends HistoryTask
    ? Parameters<Tasks[K]> extends [infer First, ...infer Rest]
        ? [First | StatsHistory, ...Rest]
        : never
    : Parameters<Tasks[K]>

export function runStatsTask<K extends keyof Tasks>(
    task: K,
    args: TaskArgs<K>,
    signal: AbortSignal
): Promise<Awaited<ReturnType<Tasks[K]>>> {
    const priority = task === "calibrationSamples" ? 0 : task === "memorised" ? 2 : 1
    const scheduled = scheduleStatsTask(priority, signal, () => startStatsTask(task, args, signal))
    if (!(args[0] instanceof StatsHistory)) return scheduled
    // A task cancellation hides its result immediately. Retain queue ownership
    // until that task returns the shared history; a search cancellation disposes
    // the history itself and terminates its worker immediately.
    return new Promise((resolve, reject) => {
        const cancel = () => reject(new DOMException("Cancelled", "AbortError"))
        signal.addEventListener("abort", cancel, { once: true })
        if (signal.aborted) cancel()
        scheduled.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel))
    })
}

function startStatsTask<K extends keyof Tasks>(
    task: K,
    args: TaskArgs<K>,
    signal: AbortSignal
): Promise<Awaited<ReturnType<Tasks[K]>>> {
    if (args[0] instanceof StatsHistory) return args[0].run(task, [undefined, ...args.slice(1)])
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
            if (
                task === "revlog" ||
                task === "memorised" ||
                task === "calibrationSamples" ||
                task === "maturation"
            ) {
                const reviews = copyRevlogValues(asRevlogHistory(args[0] as RevlogInput).values)
                worker.postMessage(
                    { task, args: [reviews, ...args.slice(1)], context: SSEother },
                    resultTransfers(reviews)
                )
            } else if (task === "calibrationPredictions" && typeof args[1] !== "string") {
                worker.postMessage({ task, args, context: SSEother }, [args[1] as ReadableStream])
            } else {
                worker.postMessage({ task, args, context: SSEother })
            }
        } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)))
        }
    })
}
