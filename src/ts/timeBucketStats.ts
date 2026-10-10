// Durations are shared across overlapping filters; each bucket retains only indices.
export type TimeBuckets = {
    values: Float64Array
    indices: Uint32Array
    offsets: Uint32Array
}

const CHUNK_SIZE = 16384
const NO_BUCKET = 0xffffffff

export class TimeBucketBuilder {
    private chunks: { values: Float64Array; buckets: Uint32Array[] }[] = []
    private counts: number[][]
    private length = 0

    constructor(groupCount: number) {
        this.counts = Array.from({ length: groupCount }, () => [])
    }

    add(seconds: number, buckets: (number | undefined)[]) {
        const offset = this.length % CHUNK_SIZE
        if (offset === 0) {
            this.chunks.push({
                values: new Float64Array(CHUNK_SIZE),
                buckets: this.counts.map(() => new Uint32Array(CHUNK_SIZE).fill(NO_BUCKET)),
            })
        }
        const chunk = this.chunks[this.chunks.length - 1]
        chunk.values[offset] = seconds
        for (let group = 0; group < this.counts.length; group++) {
            const bucket = buckets[group]
            if (bucket === undefined) continue
            chunk.buckets[group][offset] = bucket
            this.counts[group][bucket] = (this.counts[group][bucket] ?? 0) + 1
        }
        this.length++
    }

    finish(): TimeBuckets[] {
        const values = new Float64Array(this.length)
        const groups = this.counts.map((counts) => {
            const offsets = new Uint32Array(counts.length + 1)
            for (let bucket = 0; bucket < counts.length; bucket++) {
                offsets[bucket + 1] = offsets[bucket] + (counts[bucket] ?? 0)
            }
            return { values, offsets, indices: new Uint32Array(offsets[counts.length]) }
        })
        const cursors = groups.map(({ offsets }) => offsets.slice())
        let index = 0
        for (const chunk of this.chunks) {
            const count = Math.min(CHUNK_SIZE, this.length - index)
            values.set(chunk.values.subarray(0, count), index)
            for (let group = 0; group < groups.length; group++) {
                for (let offset = 0; offset < count; offset++) {
                    const bucket = chunk.buckets[group][offset]
                    if (bucket !== NO_BUCKET) {
                        groups[group].indices[cursors[group][bucket]++] = index + offset
                    }
                }
            }
            index += count
        }
        this.chunks = []
        this.counts = []
        return groups
    }
}

function bucketSamples(buckets: TimeBuckets, start: number, width: number): Float64Array {
    const last = buckets.offsets.length - 1
    const from = buckets.offsets[Math.min(last, Math.max(0, start))] ?? 0
    const to = buckets.offsets[Math.min(last, Math.max(0, start + width))] ?? 0
    const samples = new Float64Array(Math.max(0, to - from))
    for (let i = 0; i < samples.length; i++) samples[i] = buckets.values[buckets.indices[from + i]]
    return samples
}

function median(samples: Float64Array): number {
    samples.sort()
    const middle = Math.floor(samples.length / 2)
    return samples.length % 2 ? samples[middle] : (samples[middle - 1] + samples[middle]) / 2
}

export function bucketTimeStats(buckets: TimeBuckets) {
    const meanByBucket: number[] = []
    const medianByBucket: number[] = []
    for (let bucket = 0; bucket + 1 < buckets.offsets.length; bucket++) {
        const samples = bucketSamples(buckets, bucket, 1)
        if (!samples.length) continue
        meanByBucket[bucket] = samples.reduce((sum, value) => sum + value, 0) / samples.length
        medianByBucket[bucket] = median(samples)
    }
    return { meanByBucket, medianByBucket }
}

export function aggregateTimeBuckets(
    buckets: TimeBuckets | undefined,
    start: number,
    width: number,
    statistic: "mean" | "median"
): number[] {
    if (!buckets) return [0]
    const samples = bucketSamples(buckets, start, width)
    if (!samples.length) return [0]
    return [
        statistic === "mean"
            ? samples.reduce((sum, value) => sum + value, 0) / samples.length
            : median(samples),
    ]
}
