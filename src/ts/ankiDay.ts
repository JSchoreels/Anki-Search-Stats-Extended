const dayMs = 86400000

// Day keys are local calendar dates, independent of the UTC offset on page load.
export function ankiDayFromMs(ms: number, rolloverHour: number): number {
    const date = new Date(ms)
    if (date.getHours() < rolloverHour) date.setDate(date.getDate() - 1)
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / dayMs
}

export function ankiDayToMs(day: number, rolloverHour: number): number {
    const date = new Date(day * dayMs)
    return new Date(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        rolloverHour
    ).getTime()
}

export function ankiDaySnapshotMs(day: number, rolloverHour: number, now: number): number {
    return Math.min(now, ankiDayToMs(day + 1, rolloverHour) - 1)
}
