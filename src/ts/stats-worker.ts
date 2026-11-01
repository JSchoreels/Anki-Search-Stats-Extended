// Import calculators only after setting the page's scheduling/locale context.
import { RevlogHistory } from "./packedRevlogs"
import { lastForgetByCard } from "./revlogMetadata"
import { loadRevlogPages } from "./revlogPages"
import { resultTransfers } from "./workerTransfers"

const worker = self as unknown as Worker
let history: RevlogHistory | undefined

self.onmessage = async ({ data }) => {
    if (data.action === "adoptHistory") {
        history = new RevlogHistory(data.values)
        return
    }
    Object.assign(globalThis, { SSEother: data.context })
    let result: unknown
    let error: string | undefined
    try {
        if (data.action === "loadHistory") {
            history = await loadRevlogPages(async (after_id) => {
                const response = await fetch("/_anki/revlogs", {
                    method: "POST",
                    headers: { "Content-Type": "application/binary" },
                    body: JSON.stringify({ cids: data.cids, day_range: data.dayRange, after_id }),
                })
                if (!response.ok)
                    throw new Error(
                        `Endpoint revlogs failed: ${response.status} ${await response.text()}`
                    )
                return response.json()
            })
            result = { length: history.length, lastForget: lastForgetByCard(history) }
        } else {
            const { runStatsTaskLocally } = await import("./statsTasks")
            if (data.useHistory) {
                if (!history) throw new Error("Review history is unavailable")
                data.args[0] = history
            } else if (
                data.task === "revlog" ||
                data.task === "memorised" ||
                data.task === "maturation" ||
                data.task === "activeRetrievability" ||
                data.task === "calibrationSamples" ||
                data.task === "fsrsReviewWindow"
            ) {
                data.args[0] = new RevlogHistory(data.args[0])
            }
            result = await runStatsTaskLocally(data.task, data.args)
        }
    } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure)
    }
    // Return ownership even on calculator failure. Rotating this worker releases
    // its temporary heap without detaching or re-fetching the page's history.
    const historyValues = data.useHistory ? history?.values : undefined
    const message = {
        ...(error ? { error } : { result }),
        ...(historyValues ? { historyValues } : {}),
    }
    worker.postMessage(message, resultTransfers(message))
}
