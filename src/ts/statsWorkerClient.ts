import type { Revlog } from "./cardData"
import { packRevlogs } from "./packedRevlogs"
import type { Tasks } from "./statsTasks"
import { scheduleStatsTask } from "./statsWorkerQueue"

export function runStatsTask<K extends keyof Tasks>(
    task: K,
    args: Parameters<Tasks[K]>,
    signal: AbortSignal
): Promise<Awaited<ReturnType<Tasks[K]>>> {
    const priority = task === "calibrationSamples" ? 0 : task === "memorised" ? 2 : 1
    return scheduleStatsTask(priority, signal, () => startStatsTask(task, args, signal))
}

function startStatsTask<K extends keyof Tasks>(
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
            if (task === "revlog" || task === "memorised" || task === "calibrationSamples") {
                const reviews = packRevlogs(args[0] as Revlog[])
                worker.postMessage({ task, args: [reviews, ...args.slice(1)], context: SSEother }, [
                    reviews.buffer,
                ])
            } else {
                worker.postMessage({ task, args, context: SSEother })
            }
        } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)))
        }
    })
}
