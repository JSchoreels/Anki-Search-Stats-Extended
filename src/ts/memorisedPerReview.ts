/**
 * Net change in estimated memorised cards per 100 reviews.
 *
 * The rolling form divides the summed daily changes by the summed review count;
 * it deliberately does not average daily ratios. Days without reviews contribute
 * their collection-wide memory change to a later rolling window, but remain gaps
 * themselves because there is no daily denominator.
 */
export function netMemorisedPerHundredReviews(
    memorised: number[],
    reviewCounts: number[],
    windowDays = 1
): number[] {
    if (!Number.isSafeInteger(windowDays) || windowDays < 1) {
        throw new Error("Moving-average days must be a positive integer")
    }

    const length = memorised.length
    const result = Array<number>(length).fill(Number.NaN)
    const dailyChanges = Array<number>(length).fill(Number.NaN)
    const eligibleReviews = Array<number>(length).fill(0)
    let changeTotal = 0
    let reviewTotal = 0

    for (let day = 1; day < length; day++) {
        const current = memorised[day]
        const previous = memorised[day - 1]
        const validChange = Number.isFinite(current) && Number.isFinite(previous)
        const reviews =
            Number.isFinite(reviewCounts[day]) && reviewCounts[day] > 0 ? reviewCounts[day] : 0

        if (validChange) {
            dailyChanges[day] = current - previous
            eligibleReviews[day] = reviews
            changeTotal += dailyChanges[day]
            reviewTotal += reviews
        }

        const expiredDay = day - windowDays
        if (expiredDay >= 1 && Number.isFinite(dailyChanges[expiredDay])) {
            changeTotal -= dailyChanges[expiredDay]
            reviewTotal -= eligibleReviews[expiredDay]
        }

        if (validChange && reviews > 0 && reviewTotal > 0) {
            result[day] = (100 * changeTotal) / reviewTotal
        }
    }

    return result
}
