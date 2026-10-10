import { aggregateTimeBuckets, bucketTimeStats, TimeBucketBuilder } from "../src/ts/timeBucketStats"

const builder = () => new TimeBucketBuilder(6)

test("overlapping filters share durations and retain exact merged means and medians", () => {
    const samples = builder()
    samples.add(0.125, [0, undefined, 0, undefined, 1000, 2])
    samples.add(2.25, [1, 1, undefined, undefined, 1000, 2])
    samples.add(9.5, [1, 1, 1, 1, 1001, 3])
    const groups = samples.finish()
    expect(groups.every((group) => group.values === groups[0].values)).toBe(true)
    expect(Array.from(groups[0].values)).toEqual([0.125, 2.25, 9.5])
    expect(aggregateTimeBuckets(groups[0], 0, 2, "mean")).toEqual([11.875 / 3])
    expect(aggregateTimeBuckets(groups[0], 0, 2, "median")).toEqual([2.25])
    expect(aggregateTimeBuckets(groups[1], 0, 2, "median")).toEqual([5.875])
    expect(aggregateTimeBuckets(groups[2], 0, 2, "median")).toEqual([4.8125])
    expect(aggregateTimeBuckets(groups[3], 0, 2, "median")).toEqual([9.5])
    expect(aggregateTimeBuckets(groups[4], 1000, 2, "median")).toEqual([2.25])
    expect(aggregateTimeBuckets(groups[5], 2, 2, "mean")).toEqual([11.875 / 3])
    expect(bucketTimeStats(groups[0]).meanByBucket).toEqual([0.125, 5.875])
    expect(bucketTimeStats(groups[0]).medianByBucket).toEqual([0.125, 5.875])
    expect(Array.from(groups[0].values)).toEqual([0.125, 2.25, 9.5])
})

test("chunk boundaries preserve duration order and sparse bucket populations", () => {
    const samples = new TimeBucketBuilder(2)
    const reference: number[][] = [[], []]
    for (let i = 0; i < 33000; i++) {
        const seconds = (i % 193) / 1000
        samples.add(seconds, [i % 2, i % 3 === 0 ? 900 : undefined])
        reference[i % 2].push(seconds)
    }
    const [all, filtered] = samples.finish()
    for (let bucket = 0; bucket < 2; bucket++) {
        expect(aggregateTimeBuckets(all, bucket, 1, "mean")).toEqual([
            reference[bucket].reduce((a, b) => a + b) / reference[bucket].length,
        ])
    }
    expect(all.indices.length).toBe(33000)
    expect(filtered.indices.length).toBe(11000)
    expect(aggregateTimeBuckets(filtered, 0, 900, "median")).toEqual([0])
    expect(aggregateTimeBuckets(undefined, 0, 1, "mean")).toEqual([0])
    expect(aggregateTimeBuckets(new TimeBucketBuilder(1).finish()[0], 0, 1, "median")).toEqual([0])
})
