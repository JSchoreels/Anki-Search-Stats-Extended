import { resultTransfers } from "./workerTransfers"
// A page retains only this handle. The packed history lives in one worker and
// moves, without copying, to a fresh worker after each calculation to release its heap.
export class StatsHistory {
    length = 0
    lastForget: number[] = []
    private worker: Worker
    private stopped: Error | undefined
    private pending: { resolve: (value: any) => void; reject: (error: Error) => void } | undefined
    private readonly abort: () => void

    constructor(private signal: AbortSignal) {
        this.worker = this.createWorker()
        this.abort = () => this.dispose(new DOMException("Cancelled", "AbortError"))
        signal.addEventListener("abort", this.abort, { once: true })
        if (signal.aborted) this.abort()
    }

    private createWorker() {
        const worker = new Worker(SSEother.stats_worker_url)
        worker.onmessage = ({ data }) => {
            if (worker !== this.worker || this.stopped) return
            const pending = this.pending
            this.pending = undefined
            try {
                if (data.historyValues) {
                    this.worker = this.createWorker()
                    this.worker.postMessage(
                        { action: "adoptHistory", values: data.historyValues },
                        resultTransfers(data.historyValues)
                    )
                    worker.terminate()
                }
                if (data.error) pending?.reject(new Error(data.error))
                else pending?.resolve(data.result)
            } catch (error) {
                worker.terminate()
                const failure = error instanceof Error ? error : new Error(String(error))
                this.dispose(failure)
                pending?.reject(failure)
            }
        }
        worker.onerror = (event) => {
            if (worker === this.worker)
                this.dispose(new Error(event.message || "History worker failed"))
        }
        worker.onmessageerror = () => {
            if (worker === this.worker)
                this.dispose(new Error("Could not read history worker result"))
        }
        return worker
    }

    async load(cids: number[], dayRange: number) {
        const metadata = await this.request({
            action: "loadHistory",
            cids,
            dayRange,
            context: SSEother,
        })
        this.length = metadata.length
        this.lastForget = metadata.lastForget
    }

    run(task: string, args: unknown[]) {
        return this.request({ task, args, useHistory: true, context: SSEother })
    }

    private request(message: unknown): Promise<any> {
        if (this.stopped) return Promise.reject(this.stopped)
        if (this.pending) return Promise.reject(new Error("History tasks must use the stats queue"))
        return new Promise((resolve, reject) => {
            this.pending = { resolve, reject }
            try {
                this.worker.postMessage(message)
            } catch (error) {
                this.dispose(error instanceof Error ? error : new Error(String(error)))
            }
        })
    }

    dispose(error: Error = new DOMException("Cancelled", "AbortError")) {
        if (this.stopped) return
        this.stopped = error
        this.worker.terminate()
        this.signal.removeEventListener("abort", this.abort)
        this.pending?.reject(error)
        this.pending = undefined
    }
}

export async function loadStatsHistory(cids: number[], dayRange: number, signal: AbortSignal) {
    signal.throwIfAborted()
    const history = new StatsHistory(signal)
    try {
        await history.load(cids, dayRange)
        return history
    } catch (error) {
        history.dispose(error instanceof Error ? error : new Error(String(error)))
        throw error
    }
}
