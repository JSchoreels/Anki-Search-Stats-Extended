import type { BarChart, ExtraRenderInput } from "./bar"

export function formatRetrievabilityAxis({ svg }: ExtraRenderInput<BarChart>) {
    svg.select(":scope > g[transform]")
        .selectAll(".tick text")
        .text((label) => {
            const value = Number(label)
            return `${value < 0 ? 99 + value : value}%`
        })
}
