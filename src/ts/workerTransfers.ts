// Result buffers belong to the worker. Transfer each backing buffer once, including
// buffers shared by multiple time-distribution filters, without cloning their data.
export function resultTransfers(result: unknown): ArrayBuffer[] {
    const buffers = new Set<ArrayBuffer>()
    const visited = new Set<object>()
    function visit(value: unknown) {
        if (value === null || typeof value !== "object" || visited.has(value)) return
        visited.add(value)
        if (ArrayBuffer.isView(value)) {
            if (Object.prototype.toString.call(value.buffer) === "[object ArrayBuffer]")
                buffers.add(value.buffer as ArrayBuffer)
        } else if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
            buffers.add(value as ArrayBuffer)
        } else {
            for (const child of Object.values(value)) visit(child)
        }
    }
    visit(result)
    return [...buffers]
}
