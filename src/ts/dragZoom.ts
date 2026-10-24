import { pointer } from "d3"
import { tooltipShown } from "./stores"

export type ZoomRange = { start: number; end: number }
export type DragZoomOptions = {
    width: number
    height: number
    onSelect: (startFraction: number, endFraction: number) => void
}

/** Keep a local zoom inside the currently available history. */
export function boundedZoom(range: ZoomRange | undefined, domain: ZoomRange): ZoomRange {
    if (!range || range.end < domain.start || range.start > domain.end) return domain
    return { start: Math.max(domain.start, range.start), end: Math.min(domain.end, range.end) }
}

/** Inclusive days for a line, or whole buckets for a band/padded daily axis. */
export function selectedZoomRange(
    domain: ZoomRange,
    startFraction: number,
    endFraction: number,
    buckets = false
): ZoomRange {
    const left = Math.max(0, Math.min(1, Math.min(startFraction, endFraction)))
    const right = Math.max(0, Math.min(1, Math.max(startFraction, endFraction)))
    const span = domain.end - domain.start + (buckets ? 1 : 0)
    const start = Math.min(domain.end, domain.start + Math.floor(left * span))
    const end = Math.max(
        start,
        Math.min(domain.end, domain.start + Math.ceil(right * span) - (buckets ? 1 : 0))
    )
    return { start, end }
}

/** Svelte action: a horizontal drag zooms; ordinary clicks and trend handles keep their behavior. */
export function dragZoom(svg: SVGElement, initial: DragZoomOptions | undefined) {
    let options = initial
    let cleanupGesture: (() => void) | undefined
    const view = svg.ownerDocument.defaultView!

    function down(event: PointerEvent) {
        if (!options || event.button !== 0 || event.isPrimary === false || cleanupGesture) return
        if ((event.target as Element).closest(".sse-trend-handle")) return
        const current = options
        const [startX, startY] = pointer(event, svg)
        if (startX < 0 || startX > current.width || startY < 0 || startY > current.height) return
        let dragged = false
        let cancelled = false
        let selection: SVGRectElement | undefined
        const clampX = (event: PointerEvent) =>
            Math.max(0, Math.min(current.width, pointer(event, svg)[0]))

        function move(event: PointerEvent) {
            if (event.pointerId !== undefined && event.pointerId !== eventId) return
            if (cancelled) return
            if (!dragged && Math.abs(event.clientX - startClientX) < 6) return
            dragged = true
            tooltipShown.set(false)
            if (!selection) {
                selection = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect")
                selection.setAttribute("class", "sse-zoom-selection")
                selection.setAttribute("y", "0")
                selection.setAttribute("height", String(current.height))
                selection.setAttribute("fill", "currentColor")
                selection.setAttribute("fill-opacity", "0.15")
                selection.setAttribute("stroke", "currentColor")
                selection.setAttribute("pointer-events", "none")
                svg.append(selection)
            }
            const x = clampX(event)
            selection.setAttribute("x", String(Math.min(startX, x)))
            selection.setAttribute("width", String(Math.abs(x - startX)))
            event.preventDefault()
            event.stopImmediatePropagation()
        }

        // Suppress compatibility mouse events while dragging, including trend previews/tooltips.
        function mouseMove(event: MouseEvent) {
            if (dragged || cancelled) event.stopImmediatePropagation()
        }
        function suppressClick() {
            const block = (event: MouseEvent) => {
                event.preventDefault()
                event.stopImmediatePropagation()
            }
            view.addEventListener("click", block, true)
            view.setTimeout(() => view.removeEventListener("click", block, true), 0)
        }
        function up(event: PointerEvent) {
            if (event.pointerId !== undefined && event.pointerId !== eventId) return
            const x = clampX(event)
            cleanupGesture?.()
            if (dragged || cancelled) {
                suppressClick()
                event.preventDefault()
                event.stopImmediatePropagation()
            }
            if (dragged && !cancelled && x !== startX)
                current.onSelect(
                    Math.min(startX, x) / current.width,
                    Math.max(startX, x) / current.width
                )
        }
        function cancel() {
            cancelled = true
            selection?.remove()
            tooltipShown.set(false)
        }
        function keydown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                cancel()
                event.preventDefault()
            }
        }
        const eventId = event.pointerId
        const startClientX = event.clientX
        cleanupGesture = () => {
            selection?.remove()
            view.removeEventListener("pointermove", move, true)
            view.removeEventListener("mousemove", mouseMove, true)
            view.removeEventListener("mouseover", mouseMove, true)
            view.removeEventListener("pointerup", up, true)
            view.removeEventListener("pointercancel", abort, true)
            view.removeEventListener("keydown", keydown, true)
            view.removeEventListener("blur", abort)
            cleanupGesture = undefined
        }
        function abort() {
            cancel()
            cleanupGesture?.()
        }
        view.addEventListener("pointermove", move, true)
        view.addEventListener("mousemove", mouseMove, true)
        view.addEventListener("mouseover", mouseMove, true)
        view.addEventListener("pointerup", up, true)
        view.addEventListener("pointercancel", abort, true)
        view.addEventListener("keydown", keydown, true)
        view.addEventListener("blur", abort)
    }
    svg.addEventListener("pointerdown", down)
    return {
        update(next: DragZoomOptions | undefined) {
            cleanupGesture?.()
            options = next
        },
        destroy() {
            cleanupGesture?.()
            svg.removeEventListener("pointerdown", down)
        },
    }
}
