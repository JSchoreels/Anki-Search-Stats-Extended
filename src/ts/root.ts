import { get } from "svelte/store"
import { GraphsRequest, GraphsResponse } from "./proto/anki/stats_pb"
import { search } from "./search"
import { alwaysAllTime, cids, data, graphsRequest, rwkvStatsGeneration } from "./stores"

export async function decodeResponse(resp: Response) {
    const respBuf = await resp.arrayBuffer()
    const bytes = new Uint8Array(respBuf)
    return GraphsResponse.fromBinary(bytes)!
}

const encoder = new TextEncoder()

export const realFetch = fetch

function decodeRequest(req: string | Uint8Array) {
    if (typeof req == "string") {
        req = encoder.encode(req)
    }
    return GraphsRequest.fromBinary(req)
}

export function searchJoin(user: string | null, added: string | null): string {
    if (user && added) {
        return `(${user}) (${added})`
    } else if (user && !added) {
        return user!
    } else if (!user && added) {
        return added!
    } else {
        return ""
    }
}

function bodySwap(req: string | Uint8Array, newSearch: string, newLimit?: number) {
    const request = decodeRequest(req)
    request.search = searchJoin(request?.search, newSearch)
    if (newLimit !== undefined) {
        request.days = newLimit
    }
    return request.toBinary()
}

async function fetchAndDecode(fetchPromise: Promise<Response>) {
    const resp = await fetchPromise
    return await decodeResponse(resp)
}

let origBody: any = undefined
let origReq: string = ""
let origHeaders: any = { body: undefined }
let graphRequestId = 0
let scopeId = 0
let pendingKey: string | null = null

export function fetchSwappedSearch(criteria: string, limit?: number) {
    const headers = { ...origHeaders, body: bodySwap(origBody, criteria, limit) }
    return fetchAndDecode(realFetch(origReq, headers))
}

export function patchFetch() {
    //@ts-ignore
    fetch = (req: string, headers: Record<string, any>) => {
        if (req == "/_anki/graphs") {
            const requestId = ++graphRequestId

            origReq = req
            origBody = headers.body
            origHeaders = headers

            const search_request = decodeRequest(origBody)

            const limit = get(alwaysAllTime) ? 0 : undefined
            const key = JSON.stringify([search_request.search, search_request.days, limit])
            // Only reuse the current page's data while Anki retries pending RWKV
            // scores. A new search or an ordinary refresh must load fresh data.
            const retry = pendingKey === key && !/\b(?:prop|is):rwkv/i.test(search_request.search)
            pendingKey = null
            if (!retry) {
                const currentScope = ++scopeId
                cids.set(null)
                data.set(null)
                graphsRequest.set(search_request)
                search(search_request.search).then((result) => {
                    if (currentScope === scopeId) cids.set(result)
                })
            }

            const originalResponse = realFetch(req, headers).then((response) => {
                if (requestId === graphRequestId) {
                    pendingKey =
                        response.headers.get("X-Anki-Rwkv-Stats-Pending") === "1" ? key : null
                    if (retry && pendingKey === null) {
                        // Warm-up can publish historical predictions used by calibration.
                        rwkvStatsGeneration.update((generation) => generation + 1)
                    }
                }
                return response
            })
            if (retry) return originalResponse
            const currentScope = scopeId
            const defaultGraphData =
                limit === undefined || search_request.days == limit
                    ? fetchAndDecode(originalResponse.then((response) => response.clone()))
                    : fetchSwappedSearch("", limit)
            defaultGraphData.then((result) => {
                if (currentScope === scopeId) {
                    data.set(result)
                }
            })
            return originalResponse
        }
        return realFetch(req, headers)
    }
}
