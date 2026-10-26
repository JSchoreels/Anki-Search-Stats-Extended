/** Trailing calendar-day mean. Missing values are omitted and remain gaps. */
export function dailyMovingAverage(values: (number | null)[], days: number): (number | null)[] {
    if (!Number.isSafeInteger(days) || days < 1) throw new Error("Invalid moving average window")
    let sum = 0
    let count = 0
    return Array.from(values, (value, index) => {
        if (typeof value === "number" && Number.isFinite(value)) {
            sum += value
            count++
        }
        const expired = values[index - days]
        if (typeof expired === "number" && Number.isFinite(expired)) {
            sum -= expired
            count--
        }
        return typeof value === "number" && Number.isFinite(value) ? sum / count : null
    })
}

/** Trailing daily mean prepared for line charts, with missing days retained as gaps. */
export function plottableDailyMovingAverage(values: number[], days: number): number[] {
    return dailyMovingAverage(values, days).map((value) => value ?? Number.NaN)
}
