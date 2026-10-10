// Keep the last change for each card/day, in the original first-seen card order.
// Only the current day's index map is retained; older days live in numeric chunks.
const CHUNK_SIZE = 16384

export class DailyTransitions {
    private chunks: { values: Float64Array; resets: Uint8Array }[] = []
    private ranges = new Map<number, { start: number; end: number }>()
    private currentDay: number | undefined
    private currentIndices = new Map<number, number>()
    private length = 0

    set(day: number, cardId: number, key: number | null) {
        if (day !== this.currentDay) {
            if (this.currentDay !== undefined && day < this.currentDay)
                throw new Error("Daily transitions must be chronological")
            this.currentDay = day
            this.currentIndices.clear()
            this.ranges.set(day, { start: this.length, end: this.length })
        }
        let index = this.currentIndices.get(cardId)
        if (index === undefined) {
            index = this.length++
            this.currentIndices.set(cardId, index)
            if (index % CHUNK_SIZE === 0)
                this.chunks.push({
                    values: new Float64Array(CHUNK_SIZE * 2),
                    resets: new Uint8Array(CHUNK_SIZE),
                })
            this.ranges.get(day)!.end = this.length
        }
        const chunk = this.chunks[Math.floor(index / CHUNK_SIZE)]
        const offset = (index % CHUNK_SIZE) * 2
        chunk.values[offset] = cardId
        chunk.values[offset + 1] = key ?? 0
        chunk.resets[index % CHUNK_SIZE] = key === null ? 1 : 0
    }

    *entries(day: number): Generator<[number, number | null]> {
        const range = this.ranges.get(day)
        if (!range) return
        for (let index = range.start; index < range.end; index++) {
            const chunk = this.chunks[Math.floor(index / CHUNK_SIZE)]
            const offset = (index % CHUNK_SIZE) * 2
            const key = chunk.values[offset + 1]
            yield [chunk.values[offset], chunk.resets[index % CHUNK_SIZE] ? null : key]
        }
    }

    release() {
        this.chunks = []
        this.ranges.clear()
        this.currentIndices.clear()
    }
}
