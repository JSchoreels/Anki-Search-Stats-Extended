// Prediction refreshes can allocate large heaps too. Keep all stats calculations
// in one queue so they cannot overlap a full-history replay.
type Pending = { priority: number; start: () => void }
const pending: Pending[] = []
let active = false

function drain() {
    if (active || pending.length === 0) return
    pending.sort((a, b) => a.priority - b.priority)
    active = true
    pending.shift()!.start()
}

export function scheduleStatsTask<T>(
    priority: number,
    signal: AbortSignal,
    start: () => Promise<T>
): Promise<T> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException("Cancelled", "AbortError"))
            return
        }
        const cancel = () => {
            pending.splice(pending.indexOf(task), 1)
            reject(new DOMException("Cancelled", "AbortError"))
        }
        const task: Pending = {
            priority,
            start: () => {
                signal.removeEventListener("abort", cancel)
                start()
                    .then(resolve, reject)
                    .finally(() => {
                        active = false
                        queueMicrotask(drain)
                    })
            },
        }
        signal.addEventListener("abort", cancel, { once: true })
        pending.push(task)
        // Calibration gets first access even when stores enqueue graphs first.
        queueMicrotask(drain)
    })
}
