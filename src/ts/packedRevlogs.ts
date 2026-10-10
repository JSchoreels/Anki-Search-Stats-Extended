import type { Revlog } from "./cardData"

// Transfer numeric columns instead of cloning millions of JS objects. IDs need
// Float64 precision; all eight fields are numeric in Anki's review-history API.
export function packRevlogs(reviews: Revlog[]): Float64Array {
    const values = new Float64Array(reviews.length * 8)
    for (let i = 0; i < reviews.length; i++) {
        const review = reviews[i]
        const offset = i * 8
        values[offset] = review.id
        values[offset + 1] = review.cid
        values[offset + 2] = review.ease
        values[offset + 3] = review.ivl
        values[offset + 4] = review.lastIvl
        values[offset + 5] = review.time
        values[offset + 6] = review.factor
        values[offset + 7] = review.type
    }
    return values
}

// Rows are borrowed views: copy their numeric fields before retaining one.
export class RevlogCursor implements Revlog {
    constructor(
        private values: Float64Array,
        public index = 0
    ) {}
    get id() {
        return this.values[this.index * 8]
    }
    get cid() {
        return this.values[this.index * 8 + 1]
    }
    get ease() {
        return this.values[this.index * 8 + 2] as Revlog["ease"]
    }
    get ivl() {
        return this.values[this.index * 8 + 3]
    }
    get lastIvl() {
        return this.values[this.index * 8 + 4]
    }
    get time() {
        return this.values[this.index * 8 + 5]
    }
    get factor() {
        return this.values[this.index * 8 + 6]
    }
    get type() {
        return this.values[this.index * 8 + 7]
    }
}

export class RevlogHistory implements Iterable<Revlog> {
    constructor(public readonly values: Float64Array) {}
    get length() {
        return this.values.length / 8
    }
    id(index: number) {
        return this.values[index * 8]
    }
    cid(index: number) {
        return this.values[index * 8 + 1]
    }
    cursor(index = 0) {
        return new RevlogCursor(this.values, index)
    }
    *[Symbol.iterator]() {
        const row = this.cursor()
        for (row.index = 0; row.index < this.length; row.index++) yield row
    }
}

// Object arrays remain supported by the calculation helpers; loaded history is packed.
export type RevlogInput = RevlogHistory | Revlog[] | Float64Array
export function asRevlogHistory(reviews: RevlogInput): RevlogHistory {
    if (reviews instanceof RevlogHistory) return reviews
    return new RevlogHistory(reviews instanceof Float64Array ? reviews : packRevlogs(reviews))
}
