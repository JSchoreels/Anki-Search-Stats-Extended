export function aggregateTimeBuckets(
    buckets: number[][],
    start: number,
    width: number,
    statistic: "mean" | "median"
): number[] {
    const samples = buckets.slice(Math.max(0, start), Math.max(0, start + width)).flat()
    if (!samples.length) return [0]
    if (statistic === "mean") {
        return [samples.reduce((sum, value) => sum + value, 0) / samples.length]
    }
    samples.sort((a, b) => a - b)
    const middle = Math.floor(samples.length / 2)
    return [samples.length % 2 ? samples[middle] : (samples[middle - 1] + samples[middle]) / 2]
}
