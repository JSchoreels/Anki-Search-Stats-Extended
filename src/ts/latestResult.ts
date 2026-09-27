// Each derived-store subscription owns its result and any worker it starts.
export function latestResult<T>(
    set: (value: T) => void,
    load: (signal: AbortSignal) => Promise<T>
): () => void {
    const controller = new AbortController()
    load(controller.signal).then(
        (value) => {
            if (!controller.signal.aborted) set(value)
        },
        (error) => {
            if (!controller.signal.aborted) {
                console.error("Search Stats Extended:", error)
                alert(`Search Stats Extended: ${error instanceof Error ? error.message : error}`)
            }
        }
    )
    return () => controller.abort()
}
