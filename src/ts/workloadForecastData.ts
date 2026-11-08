export type ForecastBands = {
    mean: number
    p1: number
    p5: number
    p50: number
    p95: number
    p99: number
}

export type ForecastDay = {
    day: number
    due: ForecastBands
    done: ForecastBands
    new: ForecastBands
    lapses: ForecastBands
    seconds: ForecastBands
}

export type WorkloadForecastResult = {
    version: number
    days: number
    paths: number
    cards: number
    model?: "instant" | "curve"
    daily: ForecastDay[]
    scenario_sigma?: number
    scenario_history_days?: number
    scenario_calibration?: "insufficient_history"
    scenario_kind?: "stratified"
    partial?: boolean
    scenario_daily?: Array<{
        day: number
        due: [number | null, number | null, number | null]
        done: [number | null, number | null, number | null]
        new: [number | null, number | null, number | null]
        lapses: [number | null, number | null, number | null]
        seconds: [number | null, number | null, number | null]
    }>
}

export type WorkloadForecastProgress = {
    job_id?: number
    phase?: "running" | "complete" | "failed" | "missing"
    current?: number
    total?: number
    unit?: "days" | "paths"
    done?: boolean
    error?: string | null
    result?: WorkloadForecastResult | null
    partial_result?: WorkloadForecastResult | null
}

/** Which series to draw: reviews due, reviews done after limits, new cards, or time. */
export type ForecastMetric = "due" | "done" | "new" | "lapses" | "minutes"

export type ForecastPoint = ForecastBands & {
    day: number
    estimatedRange?: { low: number; high: number }
    scenarios?: { minus?: number; center: number; plus?: number }
    scenarioKind?: "stratified"
    preliminary?: boolean
}

const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

/** Select one metric per day; minutes come from the per-day answer seconds. */
export function buildForecastPoints(
    result: WorkloadForecastResult | null | undefined,
    metric: ForecastMetric
): ForecastPoint[] {
    const source = metric === "minutes" ? "seconds" : metric
    const scale = metric === "minutes" ? 1 / 60 : 1
    const scenariosByDay = new Map(
        (result?.scenario_daily ?? []).map((entry) => [entry.day, entry])
    )
    const points = (result?.daily ?? []).map((entry) => {
        const bands = entry[source] ?? ({} as Partial<ForecastBands>)
        const p1 = finite(bands.p1) * scale
        const p5 = finite(bands.p5) * scale
        const p50 = finite(bands.p50) * scale
        const p95 = finite(bands.p95) * scale
        const p99 = finite(bands.p99) * scale
        const mean = finite(bands.mean) * scale
        const point: ForecastPoint = {
            day: entry.day,
            mean,
            p1: Math.min(p1, p5),
            p5,
            p50,
            p95,
            p99: Math.max(p99, p95),
        }
        const values = scenariosByDay.get(entry.day)?.[source]
        if (values?.length === 3 && typeof values[1] === "number" && Number.isFinite(values[1])) {
            point.scenarios = {
                minus:
                    typeof values[0] === "number" && Number.isFinite(values[0])
                        ? values[0] * scale
                        : undefined,
                center: values[1] * scale,
                plus:
                    typeof values[2] === "number" && Number.isFinite(values[2])
                        ? values[2] * scale
                        : undefined,
            }
            point.mean = point.scenarios.center
            if (result?.scenario_kind === "stratified") point.scenarioKind = "stratified"
        } else if (result?.paths === 3 && !result.scenario_daily && !result.partial) {
            // The backend uses type-7 linear quantiles. For exactly three
            // paths, p1 and p99 are 98% of the way from the median to each
            // extreme, so all three samples can be recovered from the API.
            const minimum = Math.max(0, (p1 - 0.02 * p50) / 0.98)
            const maximum = Math.max(minimum, (p99 - 0.02 * p50) / 0.98)
            const variance = ((minimum - mean) ** 2 + (p50 - mean) ** 2 + (maximum - mean) ** 2) / 2
            const sd = Math.sqrt(variance)
            // Keep the indicative interval within actually simulated values,
            // including review limits; three paths cannot support tail bands.
            point.estimatedRange = {
                low: Math.min(maximum, Math.max(minimum, mean - sd)),
                high: Math.max(minimum, Math.min(maximum, mean + sd)),
            }
        }
        if (result?.partial) point.preliminary = true
        return point
    })
    return points.sort((a, b) => a.day - b.day)
}

/** Sum of the daily means over the horizon (expected total workload). */
export function forecastTotalMean(points: ForecastPoint[]) {
    return points.reduce((sum, point) => sum + point.mean, 0)
}

export function forecastProgressFraction(progress: WorkloadForecastProgress | null) {
    const total = progress?.total ?? 0
    if (!total) return 0
    return Math.max(0, Math.min(1, (progress?.current ?? 0) / total))
}

export const FORECAST_DAY_CHOICES = [7, 14, 30, 60, 90, 180, 365]
export const FORECAST_PATH_CHOICES = [3, 20, 50, 100, 200, 500]
