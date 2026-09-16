import * as d3 from "d3"

export function defaultGraphBounds() {
    return {
        width: SSEconfig.barWidth ?? 600,
        height: SSEconfig.barHeight ?? 250,
        marginLeft: 70,
        marginRight: 70,
        marginTop: 20,
        marginBottom: 25,
    }
}

export function comparisonGraphBounds() {
    const bounds = defaultGraphBounds()
    const height = Math.min(Math.round(bounds.height * 1.3), bounds.width * 0.75)
    return { ...bounds, height }
}

export function clearChart(svg: SVGElement) {
    d3.select(svg).selectAll("*").remove()
}

export const MATURE_COLOUR = "#31a354"
export const YOUNG_COLOUR = "#74c476"
export const LEARN_COLOUR = "#fd8d3c"
export const RELEARN_COLOUR = "#fb6a4a"
export const SUSPENDED_COLOUR = "#FFDC41"
export const NEW_COLOUR = "#6baed6"

export const FSRS_COMPARISON_COLOUR = "steelblue"
export const RWKV_COMPARISON_COLOUR = "seagreen"
export const COMPARISON_REFERENCE_COLOUR = "orange"
