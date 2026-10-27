/** Sum per-answer recall changes and scale them to 100 modeled answers. */
export function recallGainPerHundredReviews(
    gains: number[],
    reviewCounts: number[],
    windowDays = 1
): number[] {
    if (!Number.isSafeInteger(windowDays) || windowDays < 1) {
        throw new Error("Moving-average days must be a positive integer")
    }

    const result = Array<number>(gains.length).fill(Number.NaN)
    let gainTotal = 0
    let reviewTotal = 0
    const valid = (day: number) =>
        Number.isFinite(gains[day]) && Number.isFinite(reviewCounts[day]) && reviewCounts[day] > 0

    for (let day = 0; day < gains.length; day++) {
        if (valid(day)) {
            gainTotal += gains[day]
            reviewTotal += reviewCounts[day]
        }
        const expiredDay = day - windowDays
        if (expiredDay >= 0 && valid(expiredDay)) {
            gainTotal -= gains[expiredDay]
            reviewTotal -= reviewCounts[expiredDay]
        }
        if (valid(day) && reviewTotal > 0) result[day] = (100 * gainTotal) / reviewTotal
    }
    return result
}
