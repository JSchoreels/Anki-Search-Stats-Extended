import { get, writable, type Writable } from "svelte/store"

export function normalizeGraphIds(value: unknown): string[] {
    return Array.isArray(value)
        ? [
              ...new Set(
                  value.filter((id): id is string => typeof id === "string" && id.includes(":"))
              ),
          ]
        : []
}

export function categoryHasGraphs(ids: string[], category: string) {
    return ids.some((id) => id.startsWith(`${category}:`))
}

export function graphIsVisible(
    id: string,
    categoryVisible: boolean,
    pinned: string[],
    hidden: string[],
    showHidden: boolean
) {
    return hidden.includes(id) ? showHidden : categoryVisible || pinned.includes(id)
}

/** Save each cumulative change before publishing it; failed writes leave the UI unchanged. */
export function createGraphPreference(
    initial: unknown,
    save: (ids: string[]) => Promise<void>,
    errorMessage: string
) {
    const ids = writable(normalizeGraphIds(initial))
    let writes = Promise.resolve()
    function toggle(id: string): Promise<boolean> {
        const result = writes.then(async () => {
            const previous = get(ids)
            const next = previous.includes(id)
                ? previous.filter((item) => item !== id)
                : [...previous, id]
            try {
                await save(next)
                ids.set(next)
                return true
            } catch (error) {
                console.warn(errorMessage, error)
                return false
            }
        })
        writes = result.then(() => undefined)
        return result
    }
    return { ids, toggle }
}

export type HiddenGraphs = ReturnType<typeof createGraphPreference> & {
    target: Writable<HTMLElement | null>
}
